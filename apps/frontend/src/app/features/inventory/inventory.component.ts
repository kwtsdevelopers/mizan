import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg, fmtMilli } from '../../core/api.service';

interface Branch {
  _id: string;
  name: string;
}

interface Level {
  productId: string;
  branchId: string;
  qtyMilli: number;
  product?: { name: string; sku: string; reorderLevelMilli?: number };
}

interface ProductHit {
  _id: string;
  name: string;
  sku: string;
}

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Inventory</h1>
    <div class="card">
      <div class="toolbar">
        <select name="branch" [(ngModel)]="branchId" (ngModelChange)="load()" style="max-width: 240px">
          @for (b of branches(); track b._id) {
            <option [value]="b._id">{{ b.name }}</option>
          }
        </select>
        <span class="spacer"></span>
      </div>
      @if (error()) {
        <p class="error-text">{{ error() }}</p>
      }
      <table class="grid">
        <thead><tr><th>SKU</th><th>Product</th><th class="num">On hand</th><th></th></tr></thead>
        <tbody>
          @for (l of levels(); track l.productId) {
            <tr>
              <td>{{ l.product?.sku }}</td>
              <td>{{ l.product?.name }}</td>
              <td class="num" [class.error-text]="l.qtyMilli < 0">{{ fmtQty(l.qtyMilli) }}</td>
              <td><button class="btn btn-sm" (click)="startAdjust(l)">Adjust</button></td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="muted">No stock records for this branch.</td></tr>
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Stock adjustment</h2>
      <div class="row">
        <div>
          <label>Product (search by name/SKU)</label>
          <input name="psearch" [(ngModel)]="productSearch" (keyup.enter)="findProduct()" placeholder="Enter to search" />
          @if (productHit()) {
            <p class="muted">Selected: {{ productHit()!.name }} ({{ productHit()!.sku }})</p>
          }
        </div>
        <div>
          <label>Quantity (+/- units, e.g. 5 or -2.5)</label>
          <input name="qty" [(ngModel)]="adjustQty" inputmode="decimal" />
        </div>
        <div>
          <label>Type</label>
          <select name="type" [(ngModel)]="adjustType">
            <option value="adjustment">Adjustment</option>
            <option value="waste">Waste / damage</option>
          </select>
        </div>
        <div>
          <label>Reason</label>
          <input name="reason" [(ngModel)]="adjustReason" placeholder="Stock count correction…" />
        </div>
      </div>
      <div class="toolbar" style="margin-top: 12px">
        <button class="btn btn-primary" (click)="applyAdjustment()" [disabled]="!productHit() || busy()">Apply</button>
        @if (message()) {
          <span class="muted">{{ message() }}</span>
        }
      </div>
    </div>
  `,
})
export class InventoryComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly branches = signal<Branch[]>([]);
  readonly levels = signal<Level[]>([]);
  readonly error = signal('');
  readonly message = signal('');
  readonly busy = signal(false);
  readonly productHit = signal<ProductHit | null>(null);

  branchId = '';
  productSearch = '';
  adjustQty = '';
  adjustType: 'adjustment' | 'waste' = 'adjustment';
  adjustReason = '';

  readonly fmtQty = fmtMilli;

  async ngOnInit(): Promise<void> {
    try {
      const branches = await this.api.get<Branch[]>('org/branches');
      this.branches.set(branches);
      this.branchId = branches[0]?._id ?? '';
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  async load(): Promise<void> {
    if (!this.branchId) return;
    this.error.set('');
    try {
      const res = await this.api.get<{ items: Level[] }>('inventory/levels', { branchId: this.branchId, pageSize: 200 });
      this.levels.set(res.items);
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  startAdjust(level: Level): void {
    this.productHit.set({
      _id: level.productId,
      name: level.product?.name ?? level.productId,
      sku: level.product?.sku ?? '',
    });
  }

  async findProduct(): Promise<void> {
    try {
      const res = await this.api.get<{ items: ProductHit[] }>('catalog/products', {
        search: this.productSearch.trim(),
        pageSize: 1,
      });
      this.productHit.set(res.items[0] ?? null);
      if (!res.items[0]) this.message.set('No product matched.');
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  async applyAdjustment(): Promise<void> {
    const product = this.productHit();
    if (!product) return;
    const qtyMilli = Math.round(Number.parseFloat(this.adjustQty || '0') * 1000);
    if (!qtyMilli) {
      this.message.set('Quantity must be non-zero.');
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      await this.api.post('inventory/adjustments', {
        productId: product._id,
        branchId: this.branchId,
        qtyMilli,
        type: this.adjustType,
        note: this.adjustReason.trim() || undefined,
      });
      this.message.set('Adjustment applied.');
      this.adjustQty = '';
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }
}
