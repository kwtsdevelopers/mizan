import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleId, SubscriptionStatus } from '@mizan/shared';
import { DatabaseService } from '../database/database.service';
import { DEFAULT_PLANS } from './module-registry';

interface CachedEntitlements {
  modules: Set<ModuleId>;
  cachedAt: number;
}

/**
 * Resolves the set of modules a tenant is entitled to, from its subscription
 * and plan in the control plane. Expired/canceled subscriptions degrade to an
 * empty module set (read-only platform access); data is never deleted.
 */
@Injectable()
export class EntitlementsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EntitlementsService.name);
  private readonly cache = new Map<string, CachedEntitlements>();
  private static readonly TTL_MS = 30_000;

  constructor(private readonly db: DatabaseService) {}

  async onApplicationBootstrap(): Promise<void> {
    // Seed default plans idempotently.
    for (const plan of DEFAULT_PLANS) {
      await this.db.core.plans.updateOne(
        { planId: plan.planId },
        { $setOnInsert: { ...plan, active: true } },
        { upsert: true },
      );
    }
    this.logger.log(`Ensured ${DEFAULT_PLANS.length} default plans`);
  }

  async enabledModules(tenantId: string): Promise<Set<ModuleId>> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.cachedAt < EntitlementsService.TTL_MS) {
      return cached.modules;
    }
    const modules = await this.loadModules(tenantId);
    this.cache.set(tenantId, { modules, cachedAt: Date.now() });
    return modules;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private async loadModules(tenantId: string): Promise<Set<ModuleId>> {
    const sub = await this.db.core.subscriptions.findOne({ tenantId }).lean();
    if (!sub) return new Set();
    const now = Date.now();
    const activeStates: string[] = [SubscriptionStatus.Active, SubscriptionStatus.Trial];
    const inGrace =
      sub.status === SubscriptionStatus.PastDue &&
      sub.graceEndsAt != null &&
      sub.graceEndsAt.getTime() > now;
    if (!activeStates.includes(sub.status) && !inGrace) return new Set();
    if (sub.currentPeriodEndsAt.getTime() < now && !inGrace) return new Set();

    const plan = await this.db.core.plans.findOne({ planId: sub.planId }).lean();
    if (!plan) return new Set();
    return new Set(plan.modules as ModuleId[]);
  }
}
