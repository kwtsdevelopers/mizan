import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg, fmtMilli } from '../../core/api.service';
import { UiSelectComponent } from '../../ui/ui-select.component';

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
  imports: [FormsModule, UiSelectComponent],
  templateUrl: './inventory.component.html',
})
export class InventoryComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly branches = signal<Branch[]>([]);
  readonly branchOptions = computed(() => this.branches().map((b) => ({ value: b._id, label: b.name })));
  readonly adjustTypeOptions = [
    { value: 'adjustment', label: 'Adjustment' },
    { value: 'waste', label: 'Waste / damage' },
  ];
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
