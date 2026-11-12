import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, errMsg, fmtMilli, fmtMinor, parseMinor } from '../../core/api.service';
import { OfflineQueueService } from '../../core/offline-queue.service';
import { UiSelectComponent } from '../../ui/ui-select.component';

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

interface Customer {
  _id: string;
  name: string;
  phone?: string;
  walletMinor: number;
  loyaltyPoints: number;
}

interface CartLine {
  product: Product;
  qtyMilli: number;
}

interface CalcLine {
  line: CartLine;
  discMinor: number;
  grossMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
}

interface Calc {
  lines: CalcLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxByRate: Array<{ rateBps: number; taxMinor: number }>;
}

interface Hold {
  id: string;
  at: string;
  label: string;
  cart: CartLine[];
  customer: Customer | null;
}

interface CheckoutResponse {
  saleId: string;
  saleNumber: string;
  totalMinor: number;
  changeMinor: number;
  duplicate: boolean;
  loyaltyEarned: number;
}

const HOLDS_KEY = 'mizan.pos.holds';

@Component({
  selector: 'app-pos',
  standalone: true,
  imports: [FormsModule, UiSelectComponent],
  templateUrl: './pos.component.html',
  styleUrl: './pos.component.scss',
})
export class PosComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly queue = inject(OfflineQueueService);

  readonly branches = signal<Branch[]>([]);
  readonly branchOptions = computed(() => this.branches().map((b) => ({ value: b._id, label: b.name })));
  readonly products = signal<Product[]>([]);
  readonly cart = signal<CartLine[]>([]);
  readonly customer = signal<Customer | null>(null);
  readonly custResults = signal<Customer[]>([]);
  readonly newCustOpen = signal(false);
  readonly discountPct = signal(0);
  readonly useWallet = signal(false);
  readonly usePoints = signal(false);
  readonly holds = signal<Hold[]>(loadHolds());
  readonly holdsOpen = signal(false);
  readonly done = signal<{ saleNumber: string; changeMinor: number; loyaltyEarned: number; offline: boolean } | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);

  code = '';
  branchId = '';
  readonly cashStr = signal('');
  readonly cardStr = signal('');
  readonly discountAmtStr = signal('');
  custSearch = '';
  newCustName = '';
  newCustPhone = '';
  topupStr = '';
  pointsStr = '';

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private custTimer: ReturnType<typeof setTimeout> | null = null;

  readonly fmt = fmtMinor;
  readonly fmtQty = fmtMilli;
  readonly parse = parseMinor;

  /** Mirrors @mizan/shared money math: tax is exclusive, half-up rounding. */
  readonly calc = computed<Calc>(() => {
    const lines = this.cart();
    const grosses = lines.map((l) => Math.round((l.product.priceMinor * l.qtyMilli) / 1000));
    const subtotal = grosses.reduce((a, b) => a + b, 0);
    const pct = this.discountPct();
    const wanted = pct > 0 ? Math.round((subtotal * pct) / 100) : parseMinor(this.discountAmtStr());
    const discount = Math.min(Math.max(wanted, 0), subtotal);
    // distribute the order discount proportionally; remainder goes to the last line
    let allocated = 0;
    const calcLines: CalcLine[] = lines.map((line, i) => {
      const gross = grosses[i];
      const disc =
        i === lines.length - 1
          ? discount - allocated
          : subtotal > 0
            ? Math.floor((discount * gross) / subtotal)
            : 0;
      allocated += disc;
      const net = gross - disc;
      const tax = Math.round((net * line.product.taxRateBps) / 10000);
      return { line, discMinor: disc, grossMinor: gross, netMinor: net, taxMinor: tax, totalMinor: net + tax };
    });
    const taxMap = new Map<number, number>();
    for (const c of calcLines) {
      if (c.line.product.taxRateBps > 0) {
        taxMap.set(c.line.product.taxRateBps, (taxMap.get(c.line.product.taxRateBps) ?? 0) + c.taxMinor);
      }
    }
    return {
      lines: calcLines,
      subtotalMinor: subtotal,
      discountMinor: discount,
      taxMinor: calcLines.reduce((a, c) => a + c.taxMinor, 0),
      totalMinor: calcLines.reduce((a, c) => a + c.totalMinor, 0),
      taxByRate: [...taxMap.entries()].map(([rateBps, taxMinor]) => ({ rateBps, taxMinor })),
    };
  });

  readonly walletApplied = computed(() => {
    const cu = this.customer();
    if (!cu || !this.useWallet()) return 0;
    return Math.min(cu.walletMinor, this.calc().totalMinor);
  });
  readonly pointsApplied = computed(() => {
    const cu = this.customer();
    if (!cu || !this.usePoints()) return 0;
    return Math.min(cu.loyaltyPoints, this.calc().totalMinor - this.walletApplied());
  });
  readonly paid = computed(
    () => parseMinor(this.cashStr()) + parseMinor(this.cardStr()) + this.walletApplied() + this.pointsApplied(),
  );
  readonly remaining = computed(() => Math.max(this.calc().totalMinor - this.paid(), 0));
  readonly change = computed(() => Math.max(this.paid() - this.calc().totalMinor, 0));
  readonly earnPreview = computed(() => Math.floor(this.calc().totalMinor / 100));

  async ngOnInit(): Promise<void> {
    try {
      const branches = await this.api.get<Branch[]>('org/branches');
      this.branches.set(branches);
      this.branchId = branches[0]?._id ?? '';
    } catch (e) {
      this.error.set(errMsg(e));
    }
    await this.loadProducts('');
  }

  // ---- products ----

  async loadProducts(search: string): Promise<void> {
    try {
      const q = search ? `&search=${encodeURIComponent(search)}` : '';
      const res = await this.api.get<{ items: Product[] }>(`catalog/products?page=1&pageSize=100&status=active${q}`);
      this.products.set(res.items);
    } catch (e) {
      this.error.set(errMsg(e));
    }
  }

  onSearchChange(value: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadProducts(value.trim()), 250);
  }

  async scan(): Promise<void> {
    const code = this.code.trim();
    if (!code) return;
    this.error.set('');
    try {
      const product = await this.api.get<Product>(`catalog/products/lookup/${encodeURIComponent(code)}`);
      this.add(product);
      this.code = '';
      void this.loadProducts('');
    } catch {
      this.error.set(`Not found: ${code}`);
    }
  }

  // ---- cart ----

  add(product: Product): void {
    this.done.set(null);
    const lines = [...this.cart()];
    const existing = lines.find((l) => l.product._id === product._id);
    if (existing) {
      existing.qtyMilli += this.step(existing.product);
    } else {
      lines.push({ product, qtyMilli: 1000 });
    }
    this.cart.set([...lines]);
  }

  private step(p: Product): number {
    return p.kind === 'weighted' ? 100 : 1000;
  }

  inc(index: number): void {
    const lines = [...this.cart()];
    lines[index] = { ...lines[index], qtyMilli: lines[index].qtyMilli + this.step(lines[index].product) };
    this.cart.set(lines);
  }

  dec(index: number): void {
    const lines = [...this.cart()];
    const next = lines[index].qtyMilli - this.step(lines[index].product);
    if (next <= 0) {
      this.remove(index);
      return;
    }
    lines[index] = { ...lines[index], qtyMilli: next };
    this.cart.set(lines);
  }

  setQty(index: number, value: string): void {
    const qty = Math.round(Number.parseFloat(value || '0') * 1000);
    const lines = [...this.cart()];
    if (Number.isFinite(qty) && qty > 0) {
      lines[index] = { ...lines[index], qtyMilli: qty };
      this.cart.set(lines);
    } else {
      this.cart.set([...lines]);
    }
  }

  remove(index: number): void {
    this.cart.set(this.cart().filter((_, i) => i !== index));
  }

  clearCart(): void {
    this.cart.set([]);
    this.resetPayments();
  }

  // ---- discount ----

  setPct(p: number): void {
    this.discountAmtStr.set('');
    this.discountPct.set(this.discountPct() === p ? 0 : p);
  }

  clearDiscount(): void {
    this.discountPct.set(0);
    this.discountAmtStr.set('');
  }

  // ---- customer ----

  searchCustomers(term: string): void {
    if (this.custTimer) clearTimeout(this.custTimer);
    const t = term.trim();
    if (t.length < 2) {
      this.custResults.set([]);
      return;
    }
    this.custTimer = setTimeout(async () => {
      try {
        const res = await this.api.get<{ items: Customer[] }>(`customers?page=1&pageSize=8&search=${encodeURIComponent(t)}`);
        this.custResults.set(res.items);
      } catch (e) {
        this.error.set(errMsg(e));
      }
    }, 250);
  }

  selectCustomer(c: Customer): void {
    this.customer.set(c);
    this.custResults.set([]);
    this.custSearch = '';
    this.newCustOpen.set(false);
  }

  clearCustomer(): void {
    this.customer.set(null);
    this.useWallet.set(false);
    this.usePoints.set(false);
  }

  async createCustomer(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const c = await this.api.post<Customer>('customers', {
        name: this.newCustName.trim(),
        phone: this.newCustPhone.trim() || undefined,
      });
      this.selectCustomer(c);
      this.newCustName = '';
      this.newCustPhone = '';
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }

  async topUp(cu: Customer): Promise<void> {
    const amount = parseMinor(this.topupStr);
    if (amount <= 0) {
      this.error.set('Enter a top-up amount first');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const updated = await this.api.post<Customer>(`customers/${cu._id}/wallet`, { amountMinor: amount });
      this.customer.set(updated);
      this.topupStr = '';
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }

  async addPoints(cu: Customer): Promise<void> {
    const points = Math.round(Number.parseFloat(this.pointsStr || '0'));
    if (!Number.isFinite(points) || points <= 0) {
      this.error.set('Enter the points to add first');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const updated = await this.api.post<Customer>(`customers/${cu._id}/loyalty`, { points });
      this.customer.set(updated);
      this.pointsStr = '';
    } catch (e) {
      this.error.set(errMsg(e));
    } finally {
      this.busy.set(false);
    }
  }

  // ---- payments ----

  cashExact(): void {
    const dueAfterOthers = Math.max(
      this.calc().totalMinor - parseMinor(this.cardStr()) - this.walletApplied() - this.pointsApplied(),
      0,
    );
    this.cashStr.set(fmtMinor(dueAfterOthers));
  }

  cashAdd(units: number): void {
    this.cashStr.set(fmtMinor(parseMinor(this.cashStr()) + units * 100));
  }

  cardExact(): void {
    const dueAfterOthers = Math.max(
      this.calc().totalMinor - parseMinor(this.cashStr()) - this.walletApplied() - this.pointsApplied(),
      0,
    );
    this.cardStr.set(fmtMinor(dueAfterOthers));
  }

  private resetPayments(): void {
    this.cashStr.set('');
    this.cardStr.set('');
    this.useWallet.set(false);
    this.usePoints.set(false);
    this.clearDiscount();
  }

  // ---- hold / resume ----

  holdBill(): void {
    if (this.cart().length === 0) return;
    const hold: Hold = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      label: this.customer()?.name ?? `Bill ${this.holds().length + 1}`,
      cart: this.cart(),
      customer: this.customer(),
    };
    this.holds.set([hold, ...this.holds()]);
    saveHolds(this.holds());
    this.cart.set([]);
    this.clearCustomer();
    this.resetPayments();
  }

  resumeHold(h: Hold): void {
    if (this.cart().length > 0) this.holdBill();
    this.cart.set(h.cart);
    this.customer.set(h.customer);
    this.holds.set(this.holds().filter((x) => x.id !== h.id));
    saveHolds(this.holds());
    this.holdsOpen.set(false);
  }

  deleteHold(h: Hold): void {
    this.holds.set(this.holds().filter((x) => x.id !== h.id));
    saveHolds(this.holds());
  }

  // ---- checkout ----

  async checkout(): Promise<void> {
    this.error.set('');
    const calc = this.calc();
    const cash = parseMinor(this.cashStr());
    const card = parseMinor(this.cardStr());
    const wallet = this.walletApplied();
    const points = this.pointsApplied();
    const nonCash = card + wallet + points;
    if (nonCash > calc.totalMinor) {
      this.error.set('Card/wallet/points exceed the total — change can only be given from cash');
      return;
    }
    if (cash + nonCash < calc.totalMinor) {
      this.error.set('Payment is not enough');
      return;
    }

    const payments: Array<{ method: string; amountMinor: number }> = [];
    if (wallet > 0) payments.push({ method: 'wallet', amountMinor: wallet });
    if (points > 0) payments.push({ method: 'loyalty', amountMinor: points });
    if (card > 0) payments.push({ method: 'card', amountMinor: card });
    if (cash > 0) payments.push({ method: 'cash', amountMinor: cash });

    const clientTxId = crypto.randomUUID();
    const customerId = this.customer()?._id;
    const body = {
      clientTxId,
      branchId: this.branchId,
      customerId,
      lines: calc.lines.map((c) => ({
        productId: c.line.product._id,
        qtyMilli: c.line.qtyMilli,
        discountMinor: c.discMinor,
      })),
      payments,
    };

    this.busy.set(true);
    try {
      const res = await this.api.post<CheckoutResponse>('sales/checkout', body);
      this.finishSale(res.saleNumber, res.changeMinor, res.loyaltyEarned, false);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const offlineCapable = wallet === 0 && points === 0;
      if ((status === 0 || status === undefined || status >= 500) && offlineCapable) {
        await this.queue.enqueue({
          clientTxId,
          branchId: this.branchId,
          occurredAt: new Date().toISOString(),
          customerId,
          lines: calc.lines.map((c) => ({
            productId: c.line.product._id,
            sku: c.line.product.sku,
            name: c.line.product.name,
            qtyMilli: c.line.qtyMilli,
            unitPriceMinor: c.line.product.priceMinor,
            taxRateBps: c.line.product.taxRateBps,
            discountMinor: c.discMinor,
          })),
          payments,
          totalMinor: calc.totalMinor,
        });
        this.finishSale('Saved offline', cash + nonCash - calc.totalMinor, 0, true);
      } else {
        this.error.set(errMsg(e));
      }
    } finally {
      this.busy.set(false);
    }
  }

  private finishSale(saleNumber: string, changeMinor: number, loyaltyEarned: number, offline: boolean): void {
    this.done.set({ saleNumber, changeMinor, loyaltyEarned, offline });
    const cu = this.customer();
    this.cart.set([]);
    this.resetPayments();
    this.clearCustomer();
    if (cu && !offline) {
      // refresh balances in search results next time; nothing else needed
    }
  }

  dismissDone(): void {
    this.done.set(null);
  }
}

function loadHolds(): Hold[] {
  try {
    return JSON.parse(localStorage.getItem(HOLDS_KEY) ?? '[]') as Hold[];
  } catch {
    return [];
  }
}

function saveHolds(holds: Hold[]): void {
  localStorage.setItem(HOLDS_KEY, JSON.stringify(holds));
}
