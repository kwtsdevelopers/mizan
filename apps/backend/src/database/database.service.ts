import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';
import { AppConfigService } from '../config/app-config.service';
import { CoreModels, registerCoreModels } from './core.schemas';
import { registerTenantModels, TenantModels } from './tenant.schemas';

interface TenantConnectionEntry {
  connection: Connection;
  models: TenantModels;
  lastUsedAt: number;
}

/**
 * Manages the control-plane connection and a bounded cache of per-tenant
 * database connections.
 *
 * Security properties:
 *  - Database names are always derived server-side from the immutable tenantId
 *    (TENANT_DB_PREFIX + tenantId). User input never selects a database.
 *  - Connections/models are cached per tenantId; handles never cross tenants.
 *  - Idle connections are evicted; the cache is bounded.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private rootConnection!: Connection;
  private coreConnection!: Connection;
  private _coreModels!: CoreModels;
  private readonly tenantConnections = new Map<string, TenantConnectionEntry>();
  private evictionTimer?: NodeJS.Timeout;

  private static readonly MAX_TENANT_CONNECTIONS = 100;
  private static readonly IDLE_EVICTION_MS = 10 * 60 * 1000;
  private static readonly TENANT_ID_PATTERN = /^[a-z0-9]{8,32}$/;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    this.rootConnection = await mongoose
      .createConnection(this.config.mongoUri, {
        maxPoolSize: 20,
        serverSelectionTimeoutMS: 10_000,
      })
      .asPromise();
    this.coreConnection = this.rootConnection.useDb(this.config.coreDbName, { useCache: true });
    this._coreModels = registerCoreModels(this.coreConnection);
    await Promise.all(Object.values(this._coreModels).map((m) => m.createIndexes()));
    this.evictionTimer = setInterval(() => this.evictIdleConnections(), 60_000);
    this.evictionTimer.unref();
    this.logger.log(`Connected to MongoDB; control plane db=${this.config.coreDbName}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    this.tenantConnections.clear();
    await this.rootConnection?.close();
  }

  get core(): CoreModels {
    return this._coreModels;
  }

  get coreDb(): Connection {
    return this.coreConnection;
  }

  /** True when the underlying cluster supports multi-document transactions. */
  async supportsTransactions(): Promise<boolean> {
    try {
      const admin = this.rootConnection.db?.admin();
      if (!admin) return false;
      const hello = await admin.command({ hello: 1 });
      return Boolean(hello['setName'] ?? hello['msg'] === 'isdbgrid');
    } catch {
      return false;
    }
  }

  dbNameForTenant(tenantId: string): string {
    if (!DatabaseService.TENANT_ID_PATTERN.test(tenantId)) {
      throw new ServiceUnavailableException('Invalid tenant identifier');
    }
    return `${this.config.tenantDbPrefix}${tenantId}`;
  }

  /**
   * Get (or create) the model set for a tenant database.
   * Caller must have already validated the tenant's existence/status via
   * control-plane checks (TenantAccessService).
   */
  tenantModels(tenantId: string): TenantModels {
    const existing = this.tenantConnections.get(tenantId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.models;
    }
    if (this.tenantConnections.size >= DatabaseService.MAX_TENANT_CONNECTIONS) {
      this.evictOldest();
    }
    const dbName = this.dbNameForTenant(tenantId);
    // useDb shares the underlying socket pool (no new connection per tenant)
    const connection = this.rootConnection.useDb(dbName, { useCache: false });
    const models = registerTenantModels(connection);
    this.tenantConnections.set(tenantId, { connection, models, lastUsedAt: Date.now() });
    return models;
  }

  /** Drop all cached handles for a tenant (suspension / deletion). */
  releaseTenant(tenantId: string): void {
    this.tenantConnections.delete(tenantId);
  }

  async healthy(): Promise<boolean> {
    try {
      await this.coreConnection.db?.admin().command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  private evictIdleConnections(): void {
    const cutoff = Date.now() - DatabaseService.IDLE_EVICTION_MS;
    for (const [tenantId, entry] of this.tenantConnections) {
      if (entry.lastUsedAt < cutoff) this.tenantConnections.delete(tenantId);
    }
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestAt = Infinity;
    for (const [key, entry] of this.tenantConnections) {
      if (entry.lastUsedAt < oldestAt) {
        oldestAt = entry.lastUsedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.tenantConnections.delete(oldestKey);
  }
}
