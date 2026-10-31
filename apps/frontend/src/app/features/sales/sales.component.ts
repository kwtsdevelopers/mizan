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
  template: `
    <h1>Sales</h1>
    <div class="card">
      @if (error()) {
        <p class="error-text">{{ error() }}</p>
      }
      <table class="grid">
        <thead>
          <tr><th>Number</th><th>Date</th><th class="num">Total</th><th>Status</th><th>Source</th><th></th></tr>
        </thead>
        <tbody>
          @for (s of sales(); track s._id) {
            <tr>
              <td>{{ s.saleNumber }}</td>
              <td>{{ s.occurredAt | date: 'short' }}</td>
              <td class="num">{{ fmt(s.totalMinor) }}</td>
              <td>
                <span class="badge" [class.badge-ok]="s.status === 'completed'"
                  [class.badge-warn]="s.status === 'partially_refunded'"
                  [class.badge-danger]="s.status === 'refunded' || s.status === 'voided'">
                  {{ s.status }}
                </span>
              </td>
              <td>
                @if (s.offline) {
                  <span class="badge badge-warn">offline</span>
                } @else {
                  <span class="badge badge-muted">online</span>
                }
              </td>
              <td>
                @if (s.status === 'completed' || s.status === 'partially_refunded') {
                  <button class="btn btn-sm" (click)="selected.set(s)">Refund…</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="muted">No sales yet.</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (selected(); as sale) {
      <div class="card">
        <h2>Refund {{ sale.saleNumber }}</h2>
        <table class="grid">
          <thead><tr><th>Item</th><th class="num">Sold qty</th><th class="num">Refund qty</th></tr></thead>
          <tbody>
            @for (l of sale.lines; track l.productId; let i = $index) {
              <tr>
                <td>{{ l.description }}</td>
                <td class="num">{{ fmtQty(l.qtyMilli) }}</td>
                <td class="num">
                  <input style="width: 90px" [(ngModel)]="refundQty[l.productId]" name="rq{{ i }}" inputmode="decimal" placeholder="0" />
                </td>
              </tr>
            }
          </tbody>
        </table>
        <label>Reason</label>
        <input name="reason" [(ngModel)]="refundReason" placeholder="Damaged item…" />
        <div class="toolbar" style="margin-top: 12px">
          <button class="btn btn-danger" (click)="refund(sale)" [disabled]="busy()">Process refund</button>
          <button class="btn" (click)="selected.set(null)">Cancel</button>
          @if (message()) {
            <span class="muted">{{ message() }}</span>
          }
        </div>
      </div>
    }
  `,
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
