import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg, fmtMinor, parseMinor } from '../../core/api.service';
import { UiSelectComponent } from '../../ui/ui-select.component';

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
  imports: [FormsModule, UiSelectComponent],
  templateUrl: './products.component.html',
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
  readonly kindOptions = [
    { value: 'standard', label: 'Standard (per piece)' },
    { value: 'weighted', label: 'Weighted (per kg)' },
  ];

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
