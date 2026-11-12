import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ApiService, errMsg, fmtMilli, fmtMinor, parseMinor } from '../../core/api.service';
import { UiSelectComponent } from '../../ui/ui-select.component';

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
  imports: [FormsModule, DatePipe, UiSelectComponent],
  templateUrl: './purchasing.component.html',
})
export class PurchasingComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly orders = signal<PurchaseOrder[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly branches = signal<Array<{ _id: string; name: string }>>([]);
  readonly supplierOptions = computed(() => this.suppliers().map((s) => ({ value: s._id, label: s.name })));
  readonly branchOptions = computed(() => this.branches().map((b) => ({ value: b._id, label: b.name })));
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
