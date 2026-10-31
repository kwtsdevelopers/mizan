import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Industry } from '@mizan/shared';
import { PlatformOnly, Public } from '../auth/decorators';
import { RegisterTenantResult, TenantsService } from './tenants.service';
import { DatabaseService } from '../database/database.service';

class RegisterTenantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/, {
    message: 'slug must be lowercase letters, digits and hyphens',
  })
  slug!: string;

  @IsIn(Object.values(Industry))
  industry!: Industry;

  @IsString()
  @IsNotEmpty()
  planId!: string;

  @IsIn(['monthly', 'annual'])
  billingPeriod!: 'monthly' | 'annual';

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @IsString()
  @MaxLength(64)
  timezone!: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  adminName!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  adminPassword!: string;
}

@ApiTags('tenants')
@Controller()
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly db: DatabaseService,
  ) {}

  /** Self-service tenant onboarding. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('tenants/register')
  register(@Body() dto: RegisterTenantDto): Promise<RegisterTenantResult> {
    return this.tenants.register(dto);
  }

  @ApiBearerAuth()
  @PlatformOnly()
  @Get('platform/tenants')
  async list(@Query('status') status?: string): Promise<unknown[]> {
    const filter = status ? { status } : {};
    return this.db.core.tenants
      .find(filter)
      .select('-_id tenantId name slug industry status currency timezone createdAt activatedAt')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
  }

  @ApiBearerAuth()
  @PlatformOnly()
  @Post('platform/tenants/:tenantId/retry-provisioning')
  retry(@Param('tenantId') tenantId: string): Promise<RegisterTenantResult> {
    return this.tenants.retryProvisioning(tenantId);
  }

  @ApiBearerAuth()
  @PlatformOnly()
  @Post('platform/tenants/:tenantId/suspend')
  async suspend(@Param('tenantId') tenantId: string): Promise<{ ok: true }> {
    await this.tenants.suspend(tenantId);
    return { ok: true };
  }

  @ApiBearerAuth()
  @PlatformOnly()
  @Post('platform/tenants/:tenantId/reactivate')
  async reactivate(@Param('tenantId') tenantId: string): Promise<{ ok: true }> {
    await this.tenants.reactivate(tenantId);
    return { ok: true };
  }
}
