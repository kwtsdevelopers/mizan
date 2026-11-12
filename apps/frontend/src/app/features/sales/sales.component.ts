import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ApiService, errMsg, fmtMilli, fmtMinor } from '../../core/api.service';

interface SaleLine {
  productId: string;
  description: string;
  qtyMilli: number;
  totalMinor: number;
}

interface Sale {
  _id: string;
  saleNumber: string;
  clientTxId: string;
  totalMinor: number;
  status: string;
  offline: boolean;
  occurredAt: string;
  lines: SaleLine[];
  syncWarnings?: string[];
}

@Component({
  selector: 'app-sales',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './sales.component.html',
})
export class SalesComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly sales = signal<Sale[]>([]);
  readonly selected = signal<Sale | null>(null);
  readonly error = signal('');
  readonly message = signal('');
  readonly busy = signal(false);

  refundQty: Record<string, string> = {};
  refundReason = '';

  readonly fmt = fmtMinor;
  readonly fmtQty = fmtMilli;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const res = await this.api.get<{ items: Sale[] }>('sales', { pageSize: 100 });
      this.sales.set(res.items);
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  async refund(sale: Sale): Promise<void> {
    const lines = Object.entries(this.refundQty)
      .map(([productId, qty]) => ({ productId, qtyMilli: Math.round(Number.parseFloat(qty || '0') * 1000) }))
      .filter((l) => l.qtyMilli > 0);
    if (lines.length === 0) {
      this.message.set('Enter at least one refund quantity.');
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      await this.api.post(`sales/${sale._id}/refund`, { lines, reason: this.refundReason.trim() || 'Customer refund' });
      this.message.set('Refund processed.');
      this.selected.set(null);
      this.refundQty = {};
      this.refundReason = '';
      await this.load();
    } catch (e) {
      this.message.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }
}
