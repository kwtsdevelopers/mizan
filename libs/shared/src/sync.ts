/** Offline POS synchronization contracts shared by server and clients. */

export enum SyncItemStatus {
  Applied = 'applied',
  Duplicate = 'duplicate',
  Rejected = 'rejected',
}

export interface OfflineSaleLine {
  productId: string;
  /** denormalized for historical integrity */
  sku: string;
  description: string;
  qtyMilli: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxRateBps: number;
}

export interface OfflinePayment {
  method: 'cash' | 'card' | 'wallet' | 'loyalty' | 'other';
  amountMinor: number;
  reference?: string;
}

export interface OfflineSaleSubmission {
  /** globally unique client-generated transaction id (idempotency key) */
  clientTxId: string;
  branchId: string;
  registerId: string;
  /** device wall-clock time of the sale, ISO 8601 */
  occurredAt: string;
  lines: OfflineSaleLine[];
  payments: OfflinePayment[];
  customerId?: string;
  note?: string;
}

export interface SyncResultItem {
  clientTxId: string;
  status: SyncItemStatus;
  saleId?: string;
  saleNumber?: string;
  /** machine-readable error code when rejected */
  errorCode?: string;
  message?: string;
  /** warnings, e.g. stock went negative */
  warnings?: string[];
}

export interface SyncResponse {
  results: SyncResultItem[];
  serverTime: string;
}
