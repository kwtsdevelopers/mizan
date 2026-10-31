import { Injectable, inject, signal } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { ApiService } from './api.service';

export interface PendingSale {
  clientTxId: string;
  branchId: string;
  occurredAt: string;
  lines: Array<{
    productId: string;
    sku: string;
    name: string;
    qtyMilli: number;
    unitPriceMinor: number;
    taxRateBps: number;
    discountMinor: number;
  }>;
  payments: Array<{ method: string; amountMinor: number }>;
  totalMinor: number;
  attempts: number;
  lastError?: string;
}

class MizanDb extends Dexie {
  pendingSales!: Table<PendingSale, string>;
  constructor() {
    super('mizan-pos');
    this.version(1).stores({ pendingSales: 'clientTxId, occurredAt' });
  }
}

interface SyncResponse {
  results: Array<{ clientTxId: string; status: 'applied' | 'duplicate' | 'rejected'; errorCode?: string; warnings?: string[] }>;
}

@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
  private readonly api = inject(ApiService);
  private readonly db = new MizanDb();

  readonly pendingCount = signal(0);
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly syncing = signal(false);
  readonly lastSyncMessage = signal('');

  constructor() {
    window.addEventListener('online', () => {
      this.online.set(true);
      void this.syncNow();
    });
    window.addEventListener('offline', () => this.online.set(false));
    void this.refreshCount();
  }

  async enqueue(sale: Omit<PendingSale, 'attempts'>): Promise<void> {
    await this.db.pendingSales.put({ ...sale, attempts: 0 });
    await this.refreshCount();
  }

  async syncNow(): Promise<void> {
    if (this.syncing() || !this.online()) return;
    const pending = await this.db.pendingSales.orderBy('occurredAt').limit(100).toArray();
    if (pending.length === 0) return;
    this.syncing.set(true);
    try {
      const res = await this.api.post<SyncResponse>('sales/sync', {
        sales: pending.map((p) => ({
          clientTxId: p.clientTxId,
          branchId: p.branchId,
          registerId: 'default',
          occurredAt: p.occurredAt,
          lines: p.lines.map(({ name, ...l }) => ({ ...l, description: name })),
          payments: p.payments,
        })),
      });
      let applied = 0;
      let rejected = 0;
      for (const r of res.results) {
        if (r.status === 'applied' || r.status === 'duplicate') {
          await this.db.pendingSales.delete(r.clientTxId);
          applied++;
        } else {
          rejected++;
          await this.db.pendingSales
            .where('clientTxId')
            .equals(r.clientTxId)
            .modify((s) => {
              s.attempts += 1;
              s.lastError = r.errorCode ?? 'REJECTED';
            });
        }
      }
      this.lastSyncMessage.set(`Synced ${applied} sale(s)${rejected ? `, ${rejected} rejected` : ''}`);
    } catch (e) {
      this.lastSyncMessage.set('Sync failed; will retry');
    } finally {
      this.syncing.set(false);
      await this.refreshCount();
    }
  }

  async listPending(): Promise<PendingSale[]> {
    return this.db.pendingSales.orderBy('occurredAt').toArray();
  }

  async discard(clientTxId: string): Promise<void> {
    await this.db.pendingSales.delete(clientTxId);
    await this.refreshCount();
  }

  private async refreshCount(): Promise<void> {
    this.pendingCount.set(await this.db.pendingSales.count());
  }
}
