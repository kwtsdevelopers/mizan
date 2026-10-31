import { ForbiddenException, Injectable } from '@nestjs/common';
import { TenantStatus } from '@mizan/shared';
import { DatabaseService } from './database.service';
import { TenantModels } from './tenant.schemas';

interface CachedTenantState {
  status: TenantStatus;
  cachedAt: number;
}

/**
 * Validates tenant status before granting database access.
 * Short TTL cache keeps the hot path fast while suspension takes effect quickly.
 */
@Injectable()
export class TenantAccessService {
  private readonly cache = new Map<string, CachedTenantState>();
  private static readonly TTL_MS = 30_000;

  constructor(private readonly db: DatabaseService) {}

  async modelsFor(tenantId: string): Promise<TenantModels> {
    const status = await this.statusOf(tenantId);
    if (status !== TenantStatus.Active) {
      this.db.releaseTenant(tenantId);
      throw new ForbiddenException(`Tenant is not active (status: ${status})`);
    }
    return this.db.tenantModels(tenantId);
  }

  /** For provisioning only: access models while tenant is still provisioning. */
  provisioningModelsFor(tenantId: string): TenantModels {
    return this.db.tenantModels(tenantId);
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private async statusOf(tenantId: string): Promise<TenantStatus> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.cachedAt < TenantAccessService.TTL_MS) {
      return cached.status;
    }
    const tenant = await this.db.core.tenants.findOne({ tenantId }).lean();
    const status = (tenant?.status as TenantStatus) ?? TenantStatus.Deleted;
    this.cache.set(tenantId, { status, cachedAt: Date.now() });
    return status;
  }
}
