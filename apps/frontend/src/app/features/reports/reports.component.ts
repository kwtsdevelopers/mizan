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
  templateUrl: './reports.component.html',
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
