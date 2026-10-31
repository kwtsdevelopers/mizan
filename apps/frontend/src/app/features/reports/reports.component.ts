import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg, fmtMilli, fmtMinor } from '../../core/api.service';

interface SalesSummary {
  totals: { salesCount: number; totalMinor: number; taxMinor: number; discountMinor: number; offlineCount: number };
  refunds: { refundCount: number; refundTotalMinor: number };
  byDay: Array<{ _id: string; salesCount: number; totalMinor: number }>;
}

interface TopProduct {
  _id: string;
  sku?: string;
  description?: string;
  qtyMilli: number;
  revenueMinor: number;
}

interface LowStock {
  productId: string;
  name?: string;
  sku?: string;
  qtyMilli: number;
  reorderLevelMilli: number;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Reports</h1>
    <div class="card">
      <div class="toolbar">
        <label style="margin: 0">From</label>
        <input name="from" type="date" [(ngModel)]="from" style="max-width: 170px" />
        <label style="margin: 0">To</label>
        <input name="to" type="date" [(ngModel)]="to" style="max-width: 170px" />
        <button class="btn btn-primary" (click)="load()">Run</button>
      </div>
      @if (error()) {
        <p class="error-text">{{ error() }}</p>
      }
    </div>

    @if (summary(); as s) {
      <div class="row">
        <div class="card stat"><div class="stat-value">{{ s.totals.salesCount }}</div><div class="stat-label">Sales</div></div>
        <div class="card stat"><div class="stat-value">{{ fmt(s.totals.totalMinor) }}</div><div class="stat-label">Revenue</div></div>
        <div class="card stat"><div class="stat-value">{{ fmt(s.totals.taxMinor) }}</div><div class="stat-label">Tax collected</div></div>
        <div class="card stat"><div class="stat-value">{{ s.totals.offlineCount }}</div><div class="stat-label">Offline sales</div></div>
        <div class="card stat"><div class="stat-value">{{ fmt(s.refunds.refundTotalMinor) }}</div><div class="stat-label">Refunded ({{ s.refunds.refundCount }})</div></div>
      </div>
      <div class="card">
        <h2>Daily sales</h2>
        <table class="grid">
          <thead><tr><th>Day</th><th class="num">Sales</th><th class="num">Revenue</th></tr></thead>
          <tbody>
            @for (d of s.byDay; track d._id) {
              <tr><td>{{ d._id }}</td><td class="num">{{ d.salesCount }}</td><td class="num">{{ fmt(d.totalMinor) }}</td></tr>
            } @empty {
              <tr><td colspan="3" class="muted">No sales in range.</td></tr>
            }
          </tbody>
        </table>
      </div>
    }

    <div class="row">
      <div class="card" style="flex: 1">
        <h2>Top products</h2>
        <table class="grid">
          <thead><tr><th>Product</th><th class="num">Qty sold</th><th class="num">Revenue</th></tr></thead>
          <tbody>
            @for (p of topProducts(); track p._id) {
              <tr><td>{{ p.description ?? p.sku ?? p._id }}</td><td class="num">{{ fmtQty(p.qtyMilli) }}</td><td class="num">{{ fmt(p.revenueMinor) }}</td></tr>
            } @empty {
              <tr><td colspan="3" class="muted">No data.</td></tr>
            }
          </tbody>
        </table>
      </div>
      <div class="card" style="flex: 1">
        <h2>Low stock</h2>
        <table class="grid">
          <thead><tr><th>Product</th><th class="num">On hand</th><th class="num">Reorder level</th></tr></thead>
          <tbody>
            @for (l of lowStock(); track l.productId) {
              <tr>
                <td>{{ l.name ?? l.productId }}</td>
                <td class="num" [class.error-text]="l.qtyMilli <= 0">{{ fmtQty(l.qtyMilli) }}</td>
                <td class="num">{{ fmtQty(l.reorderLevelMilli) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="3" class="muted">Nothing below reorder level.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class ReportsComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly summary = signal<SalesSummary | null>(null);
  readonly topProducts = signal<TopProduct[]>([]);
  readonly lowStock = signal<LowStock[]>([]);
  readonly error = signal('');

  from = new Date(Date.now() - 29 * 86400e3).toISOString().slice(0, 10);
  to = new Date().toISOString().slice(0, 10);

  readonly fmt = fmtMinor;
  readonly fmtQty = fmtMilli;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const [summary, top, low] = await Promise.all([
        this.api.get<SalesSummary>('reports/sales-summary', { from: this.from, to: this.to }),
        this.api.get<TopProduct[]>('reports/top-products', { from: this.from, to: this.to, limit: 10 }),
        this.api.get<LowStock[]>('reports/low-stock'),
      ]);
      this.summary.set(summary);
      this.topProducts.set(top);
      this.lowStock.set(low);
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }
}
