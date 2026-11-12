import { Schema, InferSchemaType, Model, Connection } from 'mongoose';
import { TenantRole } from '@mizan/shared';

/**
 * Tenant operational collections (database: mizan_t_<tenantId>).
 * Every document lives inside a single tenant database - physical isolation.
 */

export const tenantUserSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    roles: { type: [String], required: true, enum: Object.values(TenantRole) },
    branchIds: { type: [String], required: true, default: [] },
    status: { type: String, required: true, enum: ['active', 'disabled'], default: 'active' },
    /** current refresh token rotation ids (hashed); bounded list */
    refreshTokenIds: { type: [String], required: true, default: [] },
    failedLoginAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date },
  },
  { collection: 'users', versionKey: false, timestamps: true },
);
tenantUserSchema.index({ email: 1 }, { unique: true });

export const branchSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, maxlength: 20 },
    address: { type: String, maxlength: 400 },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: 'branches', versionKey: false, timestamps: true },
);
branchSchema.index({ code: 1 }, { unique: true });

export const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    parentId: { type: String, default: null },
    sortOrder: { type: Number, required: true, default: 0 },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: 'categories', versionKey: false, timestamps: true },
);
categorySchema.index({ name: 1, parentId: 1 }, { unique: true });

export const productSchema = new Schema(
  {
    sku: { type: String, required: true, trim: true, maxlength: 64 },
    /** EAN/UPC and PLU codes */
    barcodes: { type: [String], required: true, default: [] },
    name: { type: String, required: true, trim: true, maxlength: 240 },
    categoryId: { type: String, default: null },
    /** standard = unit-count item; weighted = sold by weight (qty in milli-units) */
    kind: { type: String, required: true, enum: ['standard', 'weighted'], default: 'standard' },
    unit: { type: String, required: true, default: 'pc', maxlength: 16 },
    priceMinor: { type: Number, required: true, min: 0 },
    costMinor: { type: Number, required: true, min: 0, default: 0 },
    taxRateBps: { type: Number, required: true, min: 0, max: 10000, default: 0 },
    trackInventory: { type: Boolean, required: true, default: true },
    /** supermarket: batch/expiry tracking flag (batches managed in goods receipts) */
    batchTracking: { type: Boolean, required: true, default: false },
    reorderLevelMilli: { type: Number, required: true, min: 0, default: 0 },
    status: { type: String, required: true, enum: ['active', 'archived'], default: 'active' },
    version: { type: Number, required: true, default: 1 },
  },
  { collection: 'products', versionKey: false, timestamps: true },
);
productSchema.index({ sku: 1 }, { unique: true });
productSchema.index({ barcodes: 1 });
productSchema.index({ name: 'text' });
productSchema.index({ status: 1, updatedAt: -1 });

export const stockLevelSchema = new Schema(
  {
    productId: { type: String, required: true },
    branchId: { type: String, required: true },
    /** on-hand quantity in milli-units; MAY go negative for offline sales (reconciled later) */
    qtyMilli: { type: Number, required: true, default: 0 },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'stock_levels', versionKey: false },
);
stockLevelSchema.index({ productId: 1, branchId: 1 }, { unique: true });
stockLevelSchema.index({ branchId: 1 });

export const stockMovementSchema = new Schema(
  {
    productId: { type: String, required: true },
    branchId: { type: String, required: true },
    /** signed delta in milli-units */
    qtyMilli: { type: Number, required: true },
    type: {
      type: String,
      required: true,
      enum: ['sale', 'refund', 'receipt', 'adjustment', 'transfer_in', 'transfer_out', 'waste'],
    },
    refType: { type: String },
    refId: { type: String },
    /** idempotency key prevents duplicate application (e.g. offline sync retries) */
    idempotencyKey: { type: String },
    batchNumber: { type: String },
    expiryDate: { type: Date },
    note: { type: String, maxlength: 400 },
    createdBy: { type: String, required: true },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'stock_movements', versionKey: false },
);
stockMovementSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
stockMovementSchema.index({ productId: 1, branchId: 1, at: -1 });
stockMovementSchema.index({ at: -1 });

export const customerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 32 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    address: { type: String, maxlength: 400 },
    status: { type: String, required: true, enum: ['active', 'archived'], default: 'active' },
    notes: { type: String, maxlength: 1000 },
    /** prepaid store-credit balance in minor units */
    walletMinor: { type: Number, required: true, default: 0 },
    /** loyalty points; 1 point = 1 minor unit when redeemed */
    loyaltyPoints: { type: Number, required: true, default: 0 },
  },
  { collection: 'customers', versionKey: false, timestamps: true },
);
customerSchema.index({ phone: 1 }, { sparse: true });
customerSchema.index({ name: 'text' });

export const supplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    contactName: { type: String, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 32 },
    email: { type: String, trim: true, lowercase: true, maxlength: 200 },
    address: { type: String, maxlength: 400 },
    status: { type: String, required: true, enum: ['active', 'archived'], default: 'active' },
  },
  { collection: 'suppliers', versionKey: false, timestamps: true },
);
supplierSchema.index({ name: 1 }, { unique: true });

const poLineSchema = new Schema(
  {
    productId: { type: String, required: true },
    sku: { type: String, required: true },
    description: { type: String, required: true },
    qtyMilli: { type: Number, required: true, min: 1 },
    unitCostMinor: { type: Number, required: true, min: 0 },
    receivedQtyMilli: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

export const purchaseOrderSchema = new Schema(
  {
    poNumber: { type: String, required: true },
    supplierId: { type: String, required: true },
    branchId: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ['draft', 'ordered', 'partially_received', 'received', 'canceled'],
      default: 'draft',
    },
    lines: { type: [poLineSchema], required: true },
    totalMinor: { type: Number, required: true, min: 0 },
    note: { type: String, maxlength: 1000 },
    createdBy: { type: String, required: true },
  },
  { collection: 'purchase_orders', versionKey: false, timestamps: true },
);
purchaseOrderSchema.index({ poNumber: 1 }, { unique: true });
purchaseOrderSchema.index({ supplierId: 1, createdAt: -1 });

const saleLineSchema = new Schema(
  {
    productId: { type: String, required: true },
    sku: { type: String, required: true },
    description: { type: String, required: true },
    qtyMilli: { type: Number, required: true, min: 1 },
    unitPriceMinor: { type: Number, required: true, min: 0 },
    discountMinor: { type: Number, required: true, min: 0, default: 0 },
    taxRateBps: { type: Number, required: true, min: 0 },
    grossMinor: { type: Number, required: true },
    netMinor: { type: Number, required: true },
    taxMinor: { type: Number, required: true },
    totalMinor: { type: Number, required: true },
  },
  { _id: false },
);

const salePaymentSchema = new Schema(
  {
    method: { type: String, required: true, enum: ['cash', 'card', 'wallet', 'loyalty', 'other'] },
    amountMinor: { type: Number, required: true },
    reference: { type: String, maxlength: 120 },
  },
  { _id: false },
);

export const saleSchema = new Schema(
  {
    saleNumber: { type: String, required: true },
    /** idempotency key for offline/duplicate submission protection */
    clientTxId: { type: String, required: true },
    branchId: { type: String, required: true },
    registerId: { type: String, required: true, default: 'default' },
    cashierId: { type: String, required: true },
    customerId: { type: String, default: null },
    lines: { type: [saleLineSchema], required: true },
    payments: { type: [salePaymentSchema], required: true },
    subtotalMinor: { type: Number, required: true },
    discountMinor: { type: Number, required: true },
    taxMinor: { type: Number, required: true },
    totalMinor: { type: Number, required: true },
    paidMinor: { type: Number, required: true },
    changeMinor: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      required: true,
      enum: ['completed', 'voided', 'refunded', 'partially_refunded'],
      default: 'completed',
    },
    /** original sale id when this document is a refund */
    refundOfSaleId: { type: String, default: null },
    /** true when captured offline and synced later */
    offline: { type: Boolean, required: true, default: false },
    /** device wall-clock time (may differ from server time) */
    occurredAt: { type: Date, required: true },
    syncWarnings: { type: [String], required: true, default: [] },
    note: { type: String, maxlength: 500 },
  },
  { collection: 'sales', versionKey: false, timestamps: true },
);
saleSchema.index({ clientTxId: 1 }, { unique: true });
saleSchema.index({ saleNumber: 1 }, { unique: true });
saleSchema.index({ branchId: 1, occurredAt: -1 });
saleSchema.index({ occurredAt: -1 });
saleSchema.index({ cashierId: 1, occurredAt: -1 });

export const counterSchema = new Schema(
  {
    key: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { collection: 'counters', versionKey: false },
);
counterSchema.index({ key: 1 }, { unique: true });

export const cashierSessionSchema = new Schema(
  {
    cashierId: { type: String, required: true },
    branchId: { type: String, required: true },
    registerId: { type: String, required: true, default: 'default' },
    openedAt: { type: Date, required: true, default: () => new Date() },
    closedAt: { type: Date },
    openingFloatMinor: { type: Number, required: true, min: 0 },
    countedCashMinor: { type: Number },
    expectedCashMinor: { type: Number },
    varianceMinor: { type: Number },
    status: { type: String, required: true, enum: ['open', 'closed'], default: 'open' },
  },
  { collection: 'cashier_sessions', versionKey: false, timestamps: true },
);
cashierSessionSchema.index({ cashierId: 1, status: 1 });
cashierSessionSchema.index({ branchId: 1, openedAt: -1 });

export const auditEventSchema = new Schema(
  {
    at: { type: Date, required: true, default: () => new Date() },
    actorId: { type: String, required: true },
    action: { type: String, required: true },
    entityType: { type: String },
    entityId: { type: String },
    details: { type: Schema.Types.Mixed },
  },
  { collection: 'audit_events', versionKey: false },
);
auditEventSchema.index({ at: -1 });
auditEventSchema.index({ entityType: 1, entityId: 1, at: -1 });

export type TenantUserDoc = InferSchemaType<typeof tenantUserSchema>;
export type BranchDoc = InferSchemaType<typeof branchSchema>;
export type CategoryDoc = InferSchemaType<typeof categorySchema>;
export type ProductDoc = InferSchemaType<typeof productSchema>;
export type StockLevelDoc = InferSchemaType<typeof stockLevelSchema>;
export type StockMovementDoc = InferSchemaType<typeof stockMovementSchema>;
export type CustomerDoc = InferSchemaType<typeof customerSchema>;
export type SupplierDoc = InferSchemaType<typeof supplierSchema>;
export type PurchaseOrderDoc = InferSchemaType<typeof purchaseOrderSchema>;
export type SaleDoc = InferSchemaType<typeof saleSchema>;
export type CounterDoc = InferSchemaType<typeof counterSchema>;
export type CashierSessionDoc = InferSchemaType<typeof cashierSessionSchema>;
export type AuditEventDoc = InferSchemaType<typeof auditEventSchema>;

export interface TenantModels {
  users: Model<TenantUserDoc>;
  branches: Model<BranchDoc>;
  categories: Model<CategoryDoc>;
  products: Model<ProductDoc>;
  stockLevels: Model<StockLevelDoc>;
  stockMovements: Model<StockMovementDoc>;
  customers: Model<CustomerDoc>;
  suppliers: Model<SupplierDoc>;
  purchaseOrders: Model<PurchaseOrderDoc>;
  sales: Model<SaleDoc>;
  counters: Model<CounterDoc>;
  cashierSessions: Model<CashierSessionDoc>;
  auditEvents: Model<AuditEventDoc>;
}

export function registerTenantModels(conn: Connection): TenantModels {
  return {
    users: conn.model<TenantUserDoc>('User', tenantUserSchema),
    branches: conn.model<BranchDoc>('Branch', branchSchema),
    categories: conn.model<CategoryDoc>('Category', categorySchema),
    products: conn.model<ProductDoc>('Product', productSchema),
    stockLevels: conn.model<StockLevelDoc>('StockLevel', stockLevelSchema),
    stockMovements: conn.model<StockMovementDoc>('StockMovement', stockMovementSchema),
    customers: conn.model<CustomerDoc>('Customer', customerSchema),
    suppliers: conn.model<SupplierDoc>('Supplier', supplierSchema),
    purchaseOrders: conn.model<PurchaseOrderDoc>('PurchaseOrder', purchaseOrderSchema),
    sales: conn.model<SaleDoc>('Sale', saleSchema),
    counters: conn.model<CounterDoc>('Counter', counterSchema),
    cashierSessions: conn.model<CashierSessionDoc>('CashierSession', cashierSessionSchema),
    auditEvents: conn.model<AuditEventDoc>('AuditEvent', auditEventSchema),
  };
}

/** Ensure all tenant collection indexes exist (used by provisioning & migrations). */
export async function ensureTenantIndexes(models: TenantModels): Promise<void> {
  await Promise.all(Object.values(models).map((m) => m.createIndexes()));
}
