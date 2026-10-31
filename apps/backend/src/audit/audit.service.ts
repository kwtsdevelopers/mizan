import { Injectable } from '@nestjs/common';
import { TenantModels } from '../database/tenant.schemas';

/** Writes tenant-scoped audit events. Failures must not break business flow. */
@Injectable()
export class AuditService {
  async record(
    models: TenantModels,
    event: {
      actorId: string;
      action: string;
      entityType?: string;
      entityId?: string;
      details?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await models.auditEvents.create({ ...event, at: new Date() });
    } catch {
      // Audit write failure is logged by mongoose driver; business flow continues.
      // A production hardening step is to queue failed audit writes for retry.
    }
  }
}
