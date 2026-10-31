import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import {
  Industry,
  ModuleId,
  SubscriptionStatus,
  TenantRole,
  TenantStatus,
} from '@mizan/shared';
import { DatabaseService } from '../database/database.service';
import { TenantAccessService } from '../database/tenant-access.service';
import { ensureTenantIndexes } from '../database/tenant.schemas';
import { PROVISIONING_STEPS, ProvisioningStep } from '../database/core.schemas';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { validateModuleSet } from '../subscriptions/module-registry';

export interface RegisterTenantInput {
  name: string;
  slug: string;
  industry: Industry;
  planId: string;
  billingPeriod: 'monthly' | 'annual';
  currency: string;
  timezone: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
}

export interface RegisterTenantResult {
  tenantId: string;
  slug: string;
  status: TenantStatus;
}

/**
 * Tenant provisioning workflow.
 * Steps are recorded in provisioning_jobs and each step is idempotent, so a
 * failed job can be retried safely (resume from the first incomplete step).
 */
@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tenantAccess: TenantAccessService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async register(input: RegisterTenantInput): Promise<RegisterTenantResult> {
    const slug = input.slug.toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)) {
      throw new BadRequestException('Invalid slug: use lowercase letters, digits and hyphens');
    }

    const plan = await this.db.core.plans.findOne({ planId: input.planId, active: true }).lean();
    if (!plan) throw new BadRequestException(`Unknown plan: ${input.planId}`);
    if (plan.industry !== input.industry) {
      throw new BadRequestException('Plan is not available for the selected industry');
    }
    const moduleErrors = validateModuleSet(plan.modules as ModuleId[], input.industry);
    if (moduleErrors.length > 0) {
      throw new BadRequestException(`Invalid plan module set: ${moduleErrors.join('; ')}`);
    }

    const existing = await this.db.core.tenants.findOne({ slug }).lean();
    if (existing) throw new ConflictException('A business with this identifier already exists');

    // Immutable, URL-safe, server-generated tenant id.
    const tenantId = randomBytes(8).toString('hex');
    const dbName = this.db.dbNameForTenant(tenantId);

    try {
      await this.db.core.tenants.create({
        tenantId,
        name: input.name,
        slug,
        industry: input.industry,
        status: TenantStatus.Provisioning,
        dbName,
        clusterKey: 'default',
        currency: input.currency.toUpperCase(),
        timezone: input.timezone,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('A business with this identifier already exists');
      }
      throw err;
    }

    await this.db.core.provisioningJobs.updateOne(
      { tenantId },
      {
        $setOnInsert: {
          tenantId,
          status: 'pending',
          completedSteps: [],
          attempts: 0,
          input: {
            planId: input.planId,
            adminEmail: input.adminEmail.toLowerCase(),
            adminName: input.adminName,
            adminPasswordHash: await bcrypt.hash(input.adminPassword, 12),
          },
        },
      },
      { upsert: true },
    );

    await this.runProvisioning(tenantId, input.billingPeriod);

    const tenant = await this.db.core.tenants.findOne({ tenantId }).lean();
    return { tenantId, slug, status: (tenant?.status as TenantStatus) ?? TenantStatus.Provisioning };
  }

  /** Retry a failed provisioning job (platform admin operation). */
  async retryProvisioning(tenantId: string): Promise<RegisterTenantResult> {
    const tenant = await this.db.core.tenants.findOne({ tenantId }).lean();
    if (!tenant) throw new NotFoundException('Tenant not found');
    await this.runProvisioning(tenantId, 'monthly');
    const refreshed = await this.db.core.tenants.findOne({ tenantId }).lean();
    return {
      tenantId,
      slug: tenant.slug,
      status: (refreshed?.status as TenantStatus) ?? TenantStatus.Provisioning,
    };
  }

  private async runProvisioning(tenantId: string, billingPeriod: 'monthly' | 'annual'): Promise<void> {
    const job = await this.db.core.provisioningJobs.findOneAndUpdate(
      { tenantId, status: { $in: ['pending', 'failed'] } },
      { $set: { status: 'running' }, $inc: { attempts: 1 } },
      { new: true },
    );
    if (!job) {
      const done = await this.db.core.provisioningJobs.findOne({ tenantId }).lean();
      if (done?.status === 'completed') return; // idempotent re-entry
      throw new ConflictException('Provisioning already in progress');
    }

    const jobInput = job.input;
    if (!jobInput) {
      throw new ConflictException('Provisioning job is missing its input payload');
    }
    const completed = new Set(job.completedSteps as ProvisioningStep[]);
    try {
      for (const step of PROVISIONING_STEPS) {
        if (completed.has(step)) continue;
        await this.executeStep(step, tenantId, jobInput, billingPeriod);
        await this.db.core.provisioningJobs.updateOne(
          { tenantId },
          { $addToSet: { completedSteps: step } },
        );
      }
      await this.db.core.provisioningJobs.updateOne(
        { tenantId },
        { $set: { status: 'completed', lastError: null } },
      );
      await this.db.core.platformAudit.create({
        action: 'tenant.provisioned',
        tenantId,
        details: { attempts: job.attempts },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Provisioning failed for tenant ${tenantId}: ${message}`);
      await this.db.core.provisioningJobs.updateOne(
        { tenantId },
        { $set: { status: 'failed', lastError: message } },
      );
      await this.db.core.platformAudit.create({
        action: 'tenant.provisioning_failed',
        tenantId,
        details: { error: message },
      });
      throw err;
    }
  }

  private async executeStep(
    step: ProvisioningStep,
    tenantId: string,
    input: { planId: string; adminEmail: string; adminName: string; adminPasswordHash: string },
    billingPeriod: 'monthly' | 'annual',
  ): Promise<void> {
    const models = this.tenantAccess.provisioningModelsFor(tenantId);
    switch (step) {
      case 'create_database':
        // MongoDB creates the database lazily; creating a marker collection makes it real.
        await models.counters.updateOne(
          { key: '_provisioned' },
          { $setOnInsert: { key: '_provisioned', seq: 1 } },
          { upsert: true },
        );
        return;
      case 'apply_indexes':
        await ensureTenantIndexes(models);
        return;
      case 'seed_defaults': {
        await models.branches.updateOne(
          { code: 'MAIN' },
          { $setOnInsert: { name: 'Main Branch', code: 'MAIN', active: true } },
          { upsert: true },
        );
        return;
      }
      case 'create_admin_user':
        await models.users.updateOne(
          { email: input.adminEmail },
          {
            $setOnInsert: {
              email: input.adminEmail,
              passwordHash: input.adminPasswordHash,
              name: input.adminName,
              roles: [TenantRole.Owner],
              branchIds: [],
              status: 'active',
              refreshTokenIds: [],
              failedLoginAttempts: 0,
            },
          },
          { upsert: true },
        );
        return;
      case 'create_subscription': {
        const plan = await this.db.core.plans.findOne({ planId: input.planId }).lean();
        if (!plan) throw new Error(`Plan disappeared: ${input.planId}`);
        const now = new Date();
        const trialDays = plan.trialDays ?? 0;
        const periodDays = billingPeriod === 'annual' ? 365 : 30;
        const endsAt = new Date(now.getTime() + (trialDays > 0 ? trialDays : periodDays) * 86_400_000);
        await this.db.core.subscriptions.updateOne(
          { tenantId },
          {
            $setOnInsert: {
              tenantId,
              planId: input.planId,
              status: trialDays > 0 ? SubscriptionStatus.Trial : SubscriptionStatus.Active,
              billingPeriod,
              startsAt: now,
              currentPeriodEndsAt: endsAt,
            },
          },
          { upsert: true },
        );
        this.entitlements.invalidate(tenantId);
        return;
      }
      case 'verify_isolation': {
        // Verify the admin user exists in THIS tenant db and the db name matches registry.
        const tenant = await this.db.core.tenants.findOne({ tenantId }).lean();
        if (!tenant) throw new Error('Tenant registry entry missing');
        if (tenant.dbName !== this.db.dbNameForTenant(tenantId)) {
          throw new Error('Tenant database mapping mismatch');
        }
        const admin = await models.users.findOne({ email: input.adminEmail }).lean();
        if (!admin) throw new Error('Tenant admin user missing after provisioning');
        return;
      }
      case 'activate':
        await this.db.core.tenants.updateOne(
          { tenantId },
          { $set: { status: TenantStatus.Active, activatedAt: new Date() } },
        );
        this.tenantAccess.invalidate(tenantId);
        return;
      default: {
        const exhaustive: never = step;
        throw new Error(`Unknown provisioning step: ${exhaustive as string}`);
      }
    }
  }

  async suspend(tenantId: string): Promise<void> {
    const res = await this.db.core.tenants.updateOne(
      { tenantId, status: TenantStatus.Active },
      { $set: { status: TenantStatus.Suspended, suspendedAt: new Date() } },
    );
    if (res.matchedCount === 0) throw new NotFoundException('Active tenant not found');
    this.tenantAccess.invalidate(tenantId);
    this.db.releaseTenant(tenantId);
    await this.db.core.platformAudit.create({ action: 'tenant.suspended', tenantId });
  }

  async reactivate(tenantId: string): Promise<void> {
    const res = await this.db.core.tenants.updateOne(
      { tenantId, status: TenantStatus.Suspended },
      { $set: { status: TenantStatus.Active, suspendedAt: null } },
    );
    if (res.matchedCount === 0) throw new NotFoundException('Suspended tenant not found');
    this.tenantAccess.invalidate(tenantId);
    await this.db.core.platformAudit.create({ action: 'tenant.reactivated', tenantId });
  }
}
