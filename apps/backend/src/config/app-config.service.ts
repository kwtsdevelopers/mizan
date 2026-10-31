import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from './env';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  get nodeEnv(): AppEnv['NODE_ENV'] {
    return this.config.get('NODE_ENV', { infer: true });
  }
  get port(): number {
    return this.config.get('PORT', { infer: true });
  }
  get mongoUri(): string {
    return this.config.get('MONGODB_URI', { infer: true });
  }
  get coreDbName(): string {
    return this.config.get('CORE_DB_NAME', { infer: true });
  }
  get tenantDbPrefix(): string {
    return this.config.get('TENANT_DB_PREFIX', { infer: true });
  }
  get jwtAccessSecret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }
  get jwtRefreshSecret(): string {
    return this.config.get('JWT_REFRESH_SECRET', { infer: true });
  }
  get jwtAccessTtlSec(): number {
    return this.config.get('JWT_ACCESS_TTL_SEC', { infer: true });
  }
  get jwtRefreshTtlSec(): number {
    return this.config.get('JWT_REFRESH_TTL_SEC', { infer: true });
  }
  get corsOrigins(): string[] {
    return this.config
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
  }
  get platformAdminEmail(): string | undefined {
    return this.config.get('PLATFORM_ADMIN_EMAIL', { infer: true });
  }
  get platformAdminPassword(): string | undefined {
    return this.config.get('PLATFORM_ADMIN_PASSWORD', { infer: true });
  }
}
