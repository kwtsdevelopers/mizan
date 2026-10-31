import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ApiService, errMsg, fmtMilli, fmtMinor, parseMinor } from '../../core/api.service';

interface Supplier {
  _id: string;
  name: string;
  status: 'active' | 'archived';
}

interface PoLine {
  productId: string;
  productName?: string;
  qtyMilli: number;
  unitCostMinor: number;
  receivedQtyMilli: number;
}

interface PurchaseOrder {
  _id: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string;
  status: string;
  totalMinor: number;
  createdAt: string;
  lines: PoLine[];
}

interface ProductHit {
  _id: string;
  name: string;
  sku: string;
  costMinor: number;
}

@Component({
  selector: 'app-purchasing',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <h1>Purchasing</h1>
    @if (error()) {
      <p class="error-text">{{ error() }}</p>
    }
    <div class="card">
      <div class="toolbar">
        <h2 style="margin: 0">Purchase orders</h2>
        <span class="spacer"></span>
        <button class="btn btn-primary" (click)="startNew()">New PO</button>
      </div>
      <table class="grid">
        <thead><tr><th>PO</th><th>Supplier</th><th>Date</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
        <tbody>
          @for (po of orders(); track po._id) {
            <tr>
              <td>{{ po.poNumber }}</td>
              <td>{{ po.supplierName ?? po.supplierId }}</td>
              <td>{{ po.createdAt | date: 'shortDate' }}</td>
              <td class="num">{{ fmt(po.totalMinor) }}</td>
              <td><span class="badge badge-muted">{{ po.status }}</span></td>
              <td>
                @if (po.status === 'ordered' || po.status === 'partially_received') {
                  <button class="btn btn-sm" (click)="startReceive(po)">Receive…</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="muted">No purchase orders.</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (creating()) {
      <div class="card">
        <h2>New purchase order</h2>
        <div class="row">
          <div>
            <label>Supplier</label>
            <select name="supplier" [(ngModel)]="supplierId">
              @for (s of suppliers(); track s._id) {
                <option [value]="s._id">{{ s.name }}</option>
              }
            </select>
          </div>
          <div>
            <label>Deliver to branch</label>
            <select name="pobranch" [(ngModel)]="branchId">
              @for (b of branches(); track b._id) {
                <option [value]="b._id">{{ b.name }}</option>
              }
            </select>
          </div>
        </div>
        <div class="toolbar" style="margin-top: 10px">
          <input name="psearch" [(ngModel)]="productSearch" placeholder="Search product, Enter to add" (keyup.enter)="addProduct()" style="max-width: 320px" />
        </div>
        <table class="grid">
          <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Unit cost</th><th></th></tr></thead>
          <tbody>
            @for (l of newLines(); track l.productId; let i = $index) {
              <tr>
                <td>{{ l.name }}</td>
                <td class="num"><input style="width: 80px" [(ngModel)]="l.qty" name="nq{{ i }}" inputmode="decimal" /></td>
                <td class="num"><input style="width: 90px" [(ngModel)]="l.cost" name="nc{{ i }}" inputmode="decimal" /></td>
                <td><button class="btn btn-sm" (click)="removeLine(i)">×</button></td>
              </tr>
            } @empty {
              <tr><td colspan="4" class="muted">Add products above.</td></tr>
            }
          </tbody>
        </table>
        <div class="toolbar" style="margin-top: 12px">
          <button class="btn btn-primary" (click)="createPo()" [disabled]="busy() || newLines().length === 0">Create PO</button>
          <button class="btn" (click)="creating.set(false)">Cancel</button>
        </div>
      </div>
    }

    @if (receiving(); as po) {
      <div class="card">
        <h2>Receive against {{ po.poNumber }}</h2>
        <div class="row">
          <div><label>Batch number (optional)</label><input name="batch" [(ngModel)]="batchNumber" /></div>
          <div><label>Expiry date (optional)</label><input name="expiry" type="date" [(ngModel)]="expiryDate" /></div>
        </div>
        <table class="grid">
          <thead><tr><th>Product</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Receive now</th></tr></thead>
          <tbody>
            @for (l of po.lines; track l.productId; let i = $index) {
              <tr>
                <td>{{ l.productName ?? l.productId }}</td>
                <td class="num">{{ fmtQty(l.qtyMilli) }}</td>
                <td class="num">{{ fmtQty(l.receivedQtyMilli) }}</td>
                <td class="num"><input style="width: 90px" [(ngModel)]="receiveQty[l.productId]" name="rr{{ i }}" inputmode="decimal" placeholder="0" /></td>
              </tr>
            }
          </tbody>
        </table>
        <div class="toolbar" style="margin-top: 12px">
          <button class="btn btn-primary" (click)="receive(po)" [disabled]="busy()">Receive</button>
          <button class="btn" (click)="receiving.set(null)">Cancel</button>
          @if (message()) {
            <span class="muted">{{ message() }}</span>
          }
        </div>
      </div>
    }
  `,
})
export class PurchasingComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly orders = signal<PurchaseOrder[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly branches = signal<Array<{ _id: string; name: string }>>([]);
  readonly creating = signal(false);
  readonly receiving = signal<PurchaseOrder | null>(null);
  readonly newLines = signal<Array<{ productId: string; name: string; qty: string; cost: string }>>([]);
  readonly error = signal('');
  readonly message = signal('');
  readonly busy = signal(false);

  supplierId = '';
  productSearch = '';
  branchId = '';
  batchNumber = '';
  expiryDate = '';
  receiveQty: Record<string, string> = {};

  readonly fmt = fmtMinor;
  readonly fmtQty = fmtMilli;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const [orders, suppliers, branches] = await Promise.all([
        this.api.get<{ items: PurchaseOrder[] }>('purchasing/orders', { pageSize: 100 }),
        this.api.get<{ items: Supplier[] }>('suppliers', { pageSize: 100 }),
        this.api.get<Array<{ _id: string; name: string }>>('org/branches'),
      ]);
      this.orders.set(orders.items);
      this.suppliers.set(suppliers.items.filter((s) => s.status === 'active'));
      this.branches.set(branches);
      this.supplierId ||= this.suppliers()[0]?._id ?? '';
      this.branchId ||= branches[0]?._id ?? '';
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  startNew(): void {
    this.creating.set(true);
    this.receiving.set(null);
    this.newLines.set([]);
  }

  async addProduct(): Promise<void> {
    const q = this.productSearch.trim();
    if (!q) return;
    try {
      const res = await this.api.get<{ items: ProductHit[] }>('catalog/products', { search: q, pageSize: 1 });
      const hit = res.items[0];
      if (!hit) {
        this.message.set('No product matched.');
        return;
      }
      if (!this.newLines().some((l) => l.productId === hit._id)) {
        this.newLines.set([
          ...this.newLines(),
          { productId: hit._id, name: hit.name, qty: '1', cost: fmtMinor(hit.costMinor) },
        ]);
      }
      this.productSearch = '';
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  removeLine(index: number): void {
    this.newLines.set(this.newLines().filter((_, i) => i !== index));
  }

  async createPo(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.post('purchasing/orders', {
        supplierId: this.supplierId,
        branchId: this.branchId,
        lines: this.newLines().map((l) => ({
          productId: l.productId,
          qtyMilli: Math.round(Number.parseFloat(l.qty || '0') * 1000),
          unitCostMinor: parseMinor(l.cost),
        })),
      });
      this.creating.set(false);
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }

  startReceive(po: PurchaseOrder): void {
    this.receiving.set(po);
    this.creating.set(false);
    this.receiveQty = {};
  }

  async receive(po: PurchaseOrder): Promise<void> {
    const lines = Object.entries(this.receiveQty)
      .map(([productId, qty]) => ({
        productId,
        qtyMilli: Math.round(Number.parseFloat(qty || '0') * 1000),
        batchNumber: this.batchNumber.trim() || undefined,
        expiryDate: this.expiryDate || undefined,
      }))
      .filter((l) => l.qtyMilli > 0);
    if (lines.length === 0) {
      this.message.set('Enter at least one quantity.');
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      await this.api.post(`purchasing/orders/${po._id}/receive`, { lines });
      this.message.set('Goods received.');
      this.receiving.set(null);
      await this.load();
    } catch (e) {
      this.message.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }
}
