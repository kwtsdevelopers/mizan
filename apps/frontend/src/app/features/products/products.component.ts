import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg, fmtMinor, parseMinor } from '../../core/api.service';

interface Product {
  _id: string;
  sku: string;
  name: string;
  kind: 'standard' | 'weighted';
  priceMinor: number;
  costMinor: number;
  taxRateBps: number;
  barcodes: string[];
  status: 'active' | 'archived';
  trackInventory: boolean;
}

interface Category {
  _id: string;
  name: string;
}

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Products</h1>
    <div class="card">
      <div class="toolbar">
        <input name="search" [(ngModel)]="search" placeholder="Search name / SKU / barcode" (keyup.enter)="load()" style="max-width: 320px" />
        <button class="btn" (click)="load()">Search</button>
        <span class="spacer"></span>
        <button class="btn btn-primary" (click)="startNew()">New product</button>
      </div>
      @if (error()) {
        <p class="error-text">{{ error() }}</p>
      }
      <table class="grid">
        <thead>
          <tr><th>SKU</th><th>Name</th><th>Kind</th><th class="num">Price</th><th class="num">Tax %</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          @for (p of products(); track p._id) {
            <tr>
              <td>{{ p.sku }}</td>
              <td>{{ p.name }}</td>
              <td>{{ p.kind }}</td>
              <td class="num">{{ fmt(p.priceMinor) }}</td>
              <td class="num">{{ p.taxRateBps / 100 }}</td>
              <td>
                <span class="badge" [class.badge-ok]="p.status === 'active'" [class.badge-muted]="p.status !== 'active'">
                  {{ p.status === 'active' ? 'Active' : 'Archived' }}
                </span>
              </td>
              <td class="toolbar" style="margin: 0">
                <button class="btn btn-sm" (click)="edit(p)">Edit</button>
                @if (p.status === 'active') {
                  <button class="btn btn-sm btn-danger" (click)="archive(p)">Archive</button>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="muted">No products found.</td></tr>
          }
        </tbody>
      </table>
    </div>

    @if (form(); as f) {
      <div class="card">
        <h2>{{ f._id ? 'Edit product' : 'New product' }}</h2>
        <div class="row">
          <div><label>SKU</label><input name="sku" [(ngModel)]="f.sku" [disabled]="!!f._id" /></div>
          <div><label>Name</label><input name="name" [(ngModel)]="f.name" /></div>
          <div>
            <label>Kind</label>
            <select name="kind" [(ngModel)]="f.kind" [disabled]="!!f._id">
              <option value="standard">Standard (per piece)</option>
              <option value="weighted">Weighted (per kg)</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div><label>Price</label><input name="price" [(ngModel)]="f.price" inputmode="decimal" /></div>
          <div><label>Cost</label><input name="cost" [(ngModel)]="f.cost" inputmode="decimal" /></div>
          <div><label>Tax rate %</label><input name="tax" [(ngModel)]="f.taxPct" inputmode="decimal" /></div>
          <div><label>Barcodes (comma-separated)</label><input name="barcodes" [(ngModel)]="f.barcodesText" /></div>
        </div>
        <div class="toolbar" style="margin-top: 12px">
          <button class="btn btn-primary" (click)="save()" [disabled]="busy()">Save</button>
          <button class="btn" (click)="form.set(null)">Cancel</button>
        </div>
      </div>
    }
  `,
})
export class ProductsComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly products = signal<Product[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly form = signal<{
    _id?: string;
    sku: string;
    name: string;
    kind: 'standard' | 'weighted';
    price: string;
    cost: string;
    taxPct: string;
    barcodesText: string;
  } | null>(null);

  search = '';
  readonly fmt = fmtMinor;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const res = await this.api.get<{ items: Product[] }>('catalog/products', {
        search: this.search.trim() || undefined,
        pageSize: 100,
      });
      this.products.set(res.items);
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  startNew(): void {
    this.form.set({ sku: '', name: '', kind: 'standard', price: '', cost: '', taxPct: '0', barcodesText: '' });
  }

  edit(p: Product): void {
    this.form.set({
      _id: p._id,
      sku: p.sku,
      name: p.name,
      kind: p.kind,
      price: fmtMinor(p.priceMinor),
      cost: fmtMinor(p.costMinor),
      taxPct: String(p.taxRateBps / 100),
      barcodesText: p.barcodes.join(', '),
    });
  }

  async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    this.busy.set(true);
    this.error.set('');
    const body = {
      name: f.name.trim(),
      priceMinor: parseMinor(f.price),
      costMinor: parseMinor(f.cost),
      taxRateBps: Math.round(Number.parseFloat(f.taxPct || '0') * 100),
      barcodes: f.barcodesText.split(',').map((b) => b.trim()).filter(Boolean),
    };
    try {
      if (f._id) {
        await this.api.patch(`catalog/products/${f._id}`, body);
      } else {
        await this.api.post('catalog/products', { ...body, sku: f.sku.trim(), kind: f.kind });
      }
      this.form.set(null);
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }

  async archive(p: Product): Promise<void> {
    if (!confirm(`Archive ${p.name}?`)) return;
    try {
      await this.api.delete(`catalog/products/${p._id}`);
      await this.load();
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }
}
