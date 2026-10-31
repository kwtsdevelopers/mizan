import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg, fmtMilli, fmtMinor, parseMinor } from '../../core/api.service';
import { OfflineQueueService } from '../../core/offline-queue.service';

interface Branch {
  _id: string;
  code: string;
  name: string;
}

interface Product {
  _id: string;
  sku: string;
  name: string;
  kind: 'standard' | 'weighted';
  priceMinor: number;
  taxRateBps: number;
}

interface CartLine {
  product: Product;
  qtyMilli: number;
  discountMinor: number;
}

interface CheckoutResponse {
  saleId: string;
  saleNumber: string;
  totalMinor: number;
  changeMinor: number;
  duplicate: boolean;
}

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Point of Sale</h1>
    <div class="pos-grid">
      <div>
        <div class="card">
          <form (ngSubmit)="scan()" class="toolbar">
            <input
              name="code"
              [(ngModel)]="code"
              placeholder="Scan barcode or type SKU, then Enter"
              autocomplete="off"
              autofocus
              style="flex: 3"
            />
            <select name="branch" [(ngModel)]="branchId" style="flex: 1">
              @for (b of branches(); track b._id) {
                <option [value]="b._id">{{ b.name }}</option>
              }
            </select>
          </form>
          @if (error()) {
            <p class="error-text">{{ error() }}</p>
          }
          <table class="grid">
            <thead>
              <tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Disc.</th><th class="num">Total</th><th></th></tr>
            </thead>
            <tbody>
              @for (line of cart(); track line.product._id; let i = $index) {
                <tr>
                  <td>{{ line.product.name }}</td>
                  <td class="num">
                    <input
                      style="width: 72px"
                      [ngModel]="fmtQty(line.qtyMilli)"
                      (ngModelChange)="setQty(i, $event)"
                      name="qty{{ i }}"
                    />
                  </td>
                  <td class="num">{{ fmt(line.product.priceMinor) }}</td>
                  <td class="num">
                    <input
                      style="width: 72px"
                      [ngModel]="fmt(line.discountMinor)"
                      (ngModelChange)="setDiscount(i, $event)"
                      name="disc{{ i }}"
                    />
                  </td>
                  <td class="num">{{ fmt(lineTotal(line)) }}</td>
                  <td><button type="button" class="btn btn-sm" (click)="remove(i)">×</button></td>
                </tr>
              } @empty {
                <tr><td colspan="6" class="muted">Cart is empty — scan an item.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="stat">
            <div class="stat-value">{{ fmt(total()) }}</div>
            <div class="stat-label">Total (incl. tax {{ fmt(taxTotal()) }})</div>
          </div>
          <label>Cash received</label>
          <input name="cash" [(ngModel)]="cashReceived" inputmode="decimal" />
          <label>Card amount</label>
          <input name="card" [(ngModel)]="cardAmount" inputmode="decimal" />
          @if (change() >= 0 && paid() > 0) {
            <p>Change: <strong>{{ fmt(change()) }}</strong></p>
          }
          <button class="btn btn-primary" style="width: 100%; justify-content: center; margin-top: 12px"
            (click)="checkout()" [disabled]="cart().length === 0 || busy()">
            {{ busy() ? 'Processing…' : queue.online() ? 'Complete sale' : 'Complete sale (offline)' }}
          </button>
          @if (lastResult()) {
            <p class="muted" style="margin-top: 8px">{{ lastResult() }}</p>
          }
        </div>
        <div class="card">
          <h2>Offline queue</h2>
          <p>
            <span class="badge" [class.badge-ok]="queue.online()" [class.badge-danger]="!queue.online()">
              {{ queue.online() ? 'Online' : 'Offline' }}
            </span>
            <span class="badge badge-muted">{{ queue.pendingCount() }} pending</span>
          </p>
          <button class="btn btn-sm" (click)="queue.syncNow()" [disabled]="queue.syncing() || !queue.online()">
            {{ queue.syncing() ? 'Syncing…' : 'Sync now' }}
          </button>
          @if (queue.lastSyncMessage()) {
            <p class="muted">{{ queue.lastSyncMessage() }}</p>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`.pos-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }`],
})
export class PosComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly queue = inject(OfflineQueueService);

  readonly branches = signal<Branch[]>([]);
  readonly cart = signal<CartLine[]>([]);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly lastResult = signal('');

  code = '';
  branchId = '';
  cashReceived = '';
  cardAmount = '';

  readonly fmt = fmtMinor;
  readonly fmtQty = fmtMilli;

  readonly total = computed(() => this.cart().reduce((s, l) => s + this.lineTotal(l), 0));
  readonly taxTotal = computed(() =>
    this.cart().reduce((s, l) => {
      const net = this.lineTotal(l);
      const tax = Math.round((net * l.product.taxRateBps) / (10000 + l.product.taxRateBps));
      return s + tax;
    }, 0),
  );
  readonly paid = computed(() => parseMinor(this.cashReceived) + parseMinor(this.cardAmount));
  readonly change = computed(() => this.paid() - this.total());

  async ngOnInit(): Promise<void> {
    try {
      const branches = await this.api.get<Branch[]>('org/branches');
      this.branches.set(branches);
      this.branchId = branches[0]?._id ?? '';
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  lineTotal(line: CartLine): number {
    const gross = Math.round((line.product.priceMinor * line.qtyMilli) / 1000);
    return Math.max(gross - line.discountMinor, 0);
  }

  async scan(): Promise<void> {
    const code = this.code.trim();
    if (!code) return;
    this.error.set('');
    try {
      const product = await this.api.get<Product>(`catalog/products/lookup/${encodeURIComponent(code)}`);
      const lines = [...this.cart()];
      const existing = lines.find((l) => l.product._id === product._id);
      if (existing && product.kind === 'standard') {
        existing.qtyMilli += 1000;
      } else {
        lines.push({ product, qtyMilli: 1000, discountMinor: 0 });
      }
      this.cart.set([...lines]);
      this.code = '';
    } catch (e) {
      this.error.set(`Not found: ${code}`);
    }
  }

  setQty(index: number, value: string): void {
    const qty = Math.round(Number.parseFloat(value || '0') * 1000);
    const lines = [...this.cart()];
    if (Number.isFinite(qty) && qty > 0) lines[index] = { ...lines[index], qtyMilli: qty };
    this.cart.set(lines);
  }

  setDiscount(index: number, value: string): void {
    const lines = [...this.cart()];
    lines[index] = { ...lines[index], discountMinor: Math.max(parseMinor(value), 0) };
    this.cart.set(lines);
  }

  remove(index: number): void {
    this.cart.set(this.cart().filter((_, i) => i !== index));
  }

  async checkout(): Promise<void> {
    this.error.set('');
    this.lastResult.set('');
    const total = this.total();
    const cash = parseMinor(this.cashReceived);
    const card = parseMinor(this.cardAmount);
    if (cash + card < total) {
      this.error.set('Insufficient payment');
      return;
    }
    const payments = [];
    if (cash > 0) payments.push({ method: 'cash', amountMinor: cash });
    if (card > 0) payments.push({ method: 'card', amountMinor: card });

    const clientTxId = crypto.randomUUID();
    const body = {
      clientTxId,
      branchId: this.branchId,
      lines: this.cart().map((l) => ({
        productId: l.product._id,
        qtyMilli: l.qtyMilli,
        discountMinor: l.discountMinor,
      })),
      payments,
    };

    this.busy.set(true);
    try {
      const res = await this.api.post<CheckoutResponse>('sales/checkout', body);
      this.lastResult.set(`Sale ${res.saleNumber} — total ${fmtMinor(res.totalMinor)}, change ${fmtMinor(res.changeMinor)}`);
      this.resetCart();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 0 || status === undefined || status >= 500) {
        // Network/server failure: queue offline with the prices the customer paid.
        await this.queue.enqueue({
          clientTxId,
          branchId: this.branchId,
          occurredAt: new Date().toISOString(),
          lines: this.cart().map((l) => ({
            productId: l.product._id,
            sku: l.product.sku,
            name: l.product.name,
            qtyMilli: l.qtyMilli,
            unitPriceMinor: l.product.priceMinor,
            taxRateBps: l.product.taxRateBps,
            discountMinor: l.discountMinor,
          })),
          payments,
          totalMinor: total,
        });
        this.lastResult.set('Saved offline — will sync when connection returns.');
        this.resetCart();
      } else {
        this.error.set(errMsg(e));
      }
    } finally {
      this.busy.set(false);
    }
  }

  private resetCart(): void {
    this.cart.set([]);
    this.cashReceived = '';
    this.cardAmount = '';
  }
}
