import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import {
  AccessTokenPayload,
  AuthScope,
  RefreshTokenPayload,
} from '@mizan/shared';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import { TenantAccessService } from '../database/tenant-access.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const MAX_ACTIVE_REFRESH_TOKENS = 10;

@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly db: DatabaseService,
    private readonly tenantAccess: TenantAccessService,
  ) {}

  /** Bootstrap a platform admin from env on first start (dev/onboarding convenience). */
  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.platformAdminEmail;
    const password = this.config.platformAdminPassword;
    if (!email || !password) return;
    const existing = await this.db.core.platformAdmins.countDocuments();
    if (existing > 0) return;
    await this.db.core.platformAdmins.create({
      email,
      passwordHash: await bcrypt.hash(password, 12),
      name: 'Platform Administrator',
      status: 'active',
    });
    this.logger.log(`Bootstrapped platform administrator ${email}`);
  }

  async loginPlatform(email: string, password: string): Promise<TokenPair> {
    const admin = await this.db.core.platformAdmins.findOne({
      email: email.toLowerCase(),
      status: 'active',
    });
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokens({
      sub: String(admin._id),
      scope: AuthScope.Platform,
      roles: ['platform_admin'],
    });
  }

  async loginTenant(tenantSlug: string, email: string, password: string): Promise<TokenPair> {
    const tenant = await this.db.core.tenants
      .findOne({ slug: tenantSlug.toLowerCase() })
      .lean();
    if (!tenant) throw new UnauthorizedException('Invalid credentials');

    // Status check (also blocks suspended tenants from logging in)
    const models = await this.tenantAccess.modelsFor(tenant.tenantId).catch(() => {
      throw new UnauthorizedException('Tenant is not available');
    });

    const user = await models.users.findOne({ email: email.toLowerCase(), status: 'active' });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const attempts = user.failedLoginAttempts + 1;
      const update: Record<string, unknown> = { failedLoginAttempts: attempts };
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        update['lockedUntil'] = new Date(Date.now() + LOCK_MINUTES * 60_000);
        update['failedLoginAttempts'] = 0;
      }
      await models.users.updateOne({ _id: user._id }, { $set: update });
      throw new UnauthorizedException('Invalid credentials');
    }

    const rid = randomUUID();
    await models.users.updateOne(
      { _id: user._id },
      {
        $set: { failedLoginAttempts: 0, lockedUntil: null },
        $push: { refreshTokenIds: { $each: [hashRid(rid)], $slice: -MAX_ACTIVE_REFRESH_TOKENS } },
      },
    );

    return this.issueTokens(
      {
        sub: String(user._id),
        scope: AuthScope.Tenant,
        tid: tenant.tenantId,
        roles: user.roles,
      },
      rid,
    );
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException('Wrong token type');

    if (payload.scope === AuthScope.Platform) {
      const admin = await this.db.core.platformAdmins.findById(payload.sub);
      if (!admin || admin.status !== 'active') throw new UnauthorizedException('Invalid refresh token');
      return this.issueTokens({ sub: payload.sub, scope: AuthScope.Platform, roles: ['platform_admin'] });
    }

    if (!payload.tid) throw new UnauthorizedException('Invalid refresh token');
    const models = await this.tenantAccess.modelsFor(payload.tid).catch(() => {
      throw new UnauthorizedException('Tenant is not available');
    });
    const hashed = hashRid(payload.rid);
    const user = await models.users.findOne({ _id: payload.sub, status: 'active' });
    if (!user || !user.refreshTokenIds.includes(hashed)) {
      throw new UnauthorizedException('Refresh token revoked');
    }
    // Rotation: replace old rid with a new one atomically.
    const newRid = randomUUID();
    const res = await models.users.updateOne(
      { _id: user._id, refreshTokenIds: hashed },
      { $set: { 'refreshTokenIds.$': hashRid(newRid) } },
    );
    if (res.modifiedCount !== 1) throw new UnauthorizedException('Refresh token revoked');

    return this.issueTokens(
      { sub: String(user._id), scope: AuthScope.Tenant, tid: payload.tid, roles: user.roles },
      newRid,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.jwtRefreshSecret,
      });
    } catch {
      return; // already invalid - nothing to revoke
    }
    if (payload.scope !== AuthScope.Tenant || !payload.tid) return;
    const models = await this.tenantAccess.modelsFor(payload.tid).catch(() => null);
    if (!models) return;
    await models.users.updateOne(
      { _id: payload.sub },
      { $pull: { refreshTokenIds: hashRid(payload.rid) } },
    );
  }

  private async issueTokens(
    base: { sub: string; scope: AuthScope; tid?: string; roles: string[] },
    rid?: string,
  ): Promise<TokenPair> {
    const accessPayload: AccessTokenPayload = { ...base, typ: 'access' };
    const refreshPayload: RefreshTokenPayload = {
      sub: base.sub,
      scope: base.scope,
      tid: base.tid,
      rid: rid ?? randomUUID(),
      typ: 'refresh',
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.config.jwtAccessSecret,
        expiresIn: this.config.jwtAccessTtlSec,
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.config.jwtRefreshSecret,
        expiresIn: this.config.jwtRefreshTtlSec,
      }),
    ]);
    return { accessToken, refreshToken, expiresInSec: this.config.jwtAccessTtlSec };
  }
}

function hashRid(rid: string): string {
  return createHash('sha256').update(rid).digest('hex');
}
