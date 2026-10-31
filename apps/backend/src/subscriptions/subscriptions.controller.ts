import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthScope, ModuleId } from '@mizan/shared';
import { CurrentAuth, PlatformOnly, Public } from '../auth/decorators';
import { AuthUser } from '../auth/auth-user';
import { DatabaseService } from '../database/database.service';
import { EntitlementsService } from './entitlements.service';
import { MODULE_REGISTRY } from './module-registry';
import { ForbiddenException } from '@nestjs/common';

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller()
export class SubscriptionsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Public plan catalog for onboarding. */
  @Public()
  @Get('plans')
  async listPlans(): Promise<unknown[]> {
    return this.db.core.plans
      .find({ active: true })
      .select('-_id planId name industry modules limits priceMonthlyMinor priceAnnualMinor currency trialDays')
      .lean();
  }

  @Public()
  @Get('modules')
  listModules(): unknown[] {
    return Object.values(MODULE_REGISTRY);
  }

  /** Current tenant's subscription + entitlements. */
  @Get('subscription')
  async mySubscription(@CurrentAuth() user: AuthUser): Promise<unknown> {
    if (user.scope !== AuthScope.Tenant || !user.tenantId) {
      throw new ForbiddenException('Tenant context required');
    }
    const sub = await this.db.core.subscriptions
      .findOne({ tenantId: user.tenantId })
      .select('-_id planId status billingPeriod startsAt currentPeriodEndsAt graceEndsAt')
      .lean();
    const modules = await this.entitlements.enabledModules(user.tenantId);
    return { subscription: sub, enabledModules: [...modules] };
  }

  /** Platform admin: view any tenant's subscription. */
  @PlatformOnly()
  @Get('platform/tenants/:tenantId/subscription')
  async tenantSubscription(@Param('tenantId') tenantId: string): Promise<unknown> {
    const sub = await this.db.core.subscriptions.findOne({ tenantId }).lean();
    const modules = await this.entitlements.enabledModules(tenantId);
    return { subscription: sub, enabledModules: [...modules] satisfies ModuleId[] };
  }
}
