import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { FastifyRequest } from 'fastify';
import { AccessTokenPayload, AuthScope, Permission, permissionsForRoles, TenantRole } from '@mizan/shared';
import { AppConfigService } from '../config/app-config.service';
import { IS_PUBLIC_KEY } from './decorators';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice(7);
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.jwtAccessSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Wrong token type');
    }

    const permissions =
      payload.scope === AuthScope.Tenant
        ? permissionsForRoles(payload.roles as TenantRole[])
        : ([] as Permission[]);

    req.authUser = {
      userId: payload.sub,
      scope: payload.scope,
      tenantId: payload.tid,
      roles: payload.roles,
      permissions,
      branchIds: [],
    };
    return true;
  }
}
