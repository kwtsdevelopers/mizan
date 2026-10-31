import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isValidObjectId } from 'mongoose';
import {
  computeLineTotals,
  computeSaleTotals,
  LineTotals,
  OfflineSaleSubmission,
  SyncItemStatus,
  SyncResultItem,
} from '@mizan/shared';
import { TenantModels } from '../database/tenant.schemas';
import { InventoryService } from '../inventory/inventory.service';

export interface CheckoutLineInput {
  productId: string;
  qtyMilli: number;
  discountMinor: number;
}

export interface CheckoutInput {
  clientTxId: string;
  branchId: string;
  registerId: string;
  customerId?: string;
  lines: CheckoutLineInput[];
  payments: { method: 'cash' | 'card' | 'other'; amountMinor: number; reference?: string }[];
  note?: string;
}

export interface CheckoutResult {
  saleId: string;
  saleNumber: string;
  totalMinor: number;
  changeMinor: number;
  duplicate: boolean;
}

@Injectable()
export class SalesService {
  constructor(private readonly inventory: InventoryService) {}

  /**
   * Online checkout: prices and taxes are ALWAYS taken from the server-side
   * catalog; the client supplies only product ids, quantities and discounts.
   * Idempotent via the unique clientTxId index.
   */
  async checkout(models: TenantModels, cashierId: string, input: CheckoutInput): Promise<CheckoutResult> {
    if (input.lines.length === 0) throw new BadRequestException('Sale has no lines');

    const existing = await models.sales.findOne({ clientTxId: input.clientTxId }).lean();
    if (existing) {
      return {
        saleId: String(existing._id),
        saleNumber: existing.saleNumber,
        totalMinor: existing.totalMinor,
        changeMinor: existing.changeMinor,
        duplicate: true,
      };
    }

    const productIds = input.lines.map((l) => l.productId);
    if (productIds.some((id) => !isValidObjectId(id))) {
      throw new BadRequestException('Invalid product id');
    }
    const products = await models.products
      .find({ _id: { $in: productIds }, status: 'active' })
      .lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const saleLines = input.lines.map((line) => {
      const product = byId.get(line.productId);
      if (!product) throw new BadRequestException(`Product not available: ${line.productId}`);
      const totals = computeLineTotals({
        qtyMilli: line.qtyMilli,
        unitPriceMinor: product.priceMinor,
        discountMinor: line.discountMinor,
        taxRateBps: product.taxRateBps,
      });
      return {
        productId: line.productId,
        sku: product.sku,
        description: product.name,
        qtyMilli: line.qtyMilli,
        unitPriceMinor: product.priceMinor,
        taxRateBps: product.taxRateBps,
        ...totals,
        trackInventory: product.trackInventory,
      };
    });

    const totals = computeSaleTotals(saleLines as unknown as LineTotals[]);
    const paidMinor = input.payments.reduce((sum, p) => sum + p.amountMinor, 0);
    if (input.payments.some((p) => p.amountMinor <= 0)) {
      throw new BadRequestException('Payment amounts must be positive');
    }
    if (paidMinor < totals.totalMinor) {
      throw new BadRequestException('Insufficient payment');
    }
    const changeMinor = paidMinor - totals.totalMinor;
    // Change is only allowed against cash payments.
    const cashMinor = input.payments
      .filter((p) => p.method === 'cash')
      .reduce((s, p) => s + p.amountMinor, 0);
    if (changeMinor > 0 && changeMinor > cashMinor) {
      throw new BadRequestException('Change exceeds cash tendered');
    }

    const saleNumber = await this.nextSaleNumber(models, input.branchId);

    let saleId: string;
    try {
      const sale = await models.sales.create({
        saleNumber,
        clientTxId: input.clientTxId,
        branchId: input.branchId,
        registerId: input.registerId,
        cashierId,
        customerId: input.customerId ?? null,
        lines: saleLines.map(({ trackInventory: _t, ...rest }) => rest),
        payments: input.payments,
        ...totals,
        paidMinor,
        changeMinor,
        status: 'completed',
        offline: false,
        occurredAt: new Date(),
        syncWarnings: [],
        note: input.note,
      });
      saleId = String(sale._id);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        const dup = await models.sales.findOne({ clientTxId: input.clientTxId }).lean();
        if (dup) {
          return {
            saleId: String(dup._id),
            saleNumber: dup.saleNumber,
            totalMinor: dup.totalMinor,
            changeMinor: dup.changeMinor,
            duplicate: true,
          };
        }
      }
      throw err;
    }

    await this.deductStock(models, cashierId, input.clientTxId, saleId, input.branchId, saleLines);

    return { saleId, saleNumber, totalMinor: totals.totalMinor, changeMinor, duplicate: false };
  }

  /**
   * Offline sync: idempotently ingest sales captured while disconnected.
   * Policy (documented in OFFLINE_SYNC.md):
   *  - Client-captured prices are honored (the price shown to the customer is
   *    the price charged); price drift against the current catalog is recorded
   *    as a warning for review.
   *  - Stock may go negative; a warning is recorded for reconciliation.
   */
  async syncOfflineSales(
    models: TenantModels,
    cashierId: string,
    submissions: OfflineSaleSubmission[],
  ): Promise<SyncResultItem[]> {
    const results: SyncResultItem[] = [];
    for (const sub of submissions) {
      try {
        results.push(await this.ingestOfflineSale(models, cashierId, sub));
      } catch (err) {
        results.push({
          clientTxId: sub.clientTxId,
          status: SyncItemStatus.Rejected,
          errorCode: 'SYNC_FAILED',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    return results;
  }

  private async ingestOfflineSale(
    models: TenantModels,
    cashierId: string,
    sub: OfflineSaleSubmission,
  ): Promise<SyncResultItem> {
    const existing = await models.sales.findOne({ clientTxId: sub.clientTxId }).lean();
    if (existing) {
      return {
        clientTxId: sub.clientTxId,
        status: SyncItemStatus.Duplicate,
        saleId: String(existing._id),
        saleNumber: existing.saleNumber,
      };
    }
    if (!sub.lines?.length) {
      return {
        clientTxId: sub.clientTxId,
        status: SyncItemStatus.Rejected,
        errorCode: 'EMPTY_SALE',
        message: 'Sale has no lines',
      };
    }

    const warnings: string[] = [];
    const occurredAt = new Date(sub.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      return {
        clientTxId: sub.clientTxId,
        status: SyncItemStatus.Rejected,
        errorCode: 'INVALID_TIMESTAMP',
        message: 'occurredAt is not a valid ISO date',
      };
    }
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
      warnings.push('Device clock appears ahead of server time');
    }

    const productIds = [...new Set(sub.lines.map((l) => l.productId))].filter((id) =>
      isValidObjectId(id),
    );
    const products = await models.products.find({ _id: { $in: productIds } }).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const saleLines = sub.lines.map((line) => {
      const totals = computeLineTotals({
        qtyMilli: line.qtyMilli,
        unitPriceMinor: line.unitPriceMinor,
        discountMinor: line.discountMinor,
        taxRateBps: line.taxRateBps,
      });
      const product = byId.get(line.productId);
      if (!product) {
        warnings.push(`Product ${line.sku} no longer exists in catalog`);
      } else if (product.priceMinor !== line.unitPriceMinor) {
        warnings.push(
          `Price drift on ${line.sku}: charged ${line.unitPriceMinor}, current ${product.priceMinor}`,
        );
      }
      return {
        productId: line.productId,
        sku: line.sku,
        description: line.description,
        qtyMilli: line.qtyMilli,
        unitPriceMinor: line.unitPriceMinor,
        taxRateBps: line.taxRateBps,
        ...totals,
        trackInventory: product?.trackInventory ?? false,
      };
    });

    const totals = computeSaleTotals(saleLines as unknown as LineTotals[]);
    const paidMinor = sub.payments.reduce((s, p) => s + p.amountMinor, 0);
    if (paidMinor < totals.totalMinor) {
      return {
        clientTxId: sub.clientTxId,
        status: SyncItemStatus.Rejected,
        errorCode: 'UNDERPAID',
        message: 'Recorded payments do not cover the sale total',
      };
    }

    const saleNumber = await this.nextSaleNumber(models, sub.branchId);
    let saleId: string;
    try {
      const sale = await models.sales.create({
        saleNumber,
        clientTxId: sub.clientTxId,
        branchId: sub.branchId,
        registerId: sub.registerId,
        cashierId,
        customerId: sub.customerId ?? null,
        lines: saleLines.map(({ trackInventory: _t, ...rest }) => rest),
        payments: sub.payments,
        ...totals,
        paidMinor,
        changeMinor: paidMinor - totals.totalMinor,
        status: 'completed',
        offline: true,
        occurredAt,
        syncWarnings: warnings,
        note: sub.note,
      });
      saleId = String(sale._id);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        const dup = await models.sales.findOne({ clientTxId: sub.clientTxId }).lean();
        if (dup) {
          return {
            clientTxId: sub.clientTxId,
            status: SyncItemStatus.Duplicate,
            saleId: String(dup._id),
            saleNumber: dup.saleNumber,
          };
        }
      }
      throw err;
    }

    const stockWarnings = await this.deductStock(
      models,
      cashierId,
      sub.clientTxId,
      saleId,
      sub.branchId,
      saleLines,
    );
    warnings.push(...stockWarnings);
    if (stockWarnings.length > 0) {
      await models.sales.updateOne({ _id: saleId }, { $set: { syncWarnings: warnings } });
    }

    return {
      clientTxId: sub.clientTxId,
      status: SyncItemStatus.Applied,
      saleId,
      saleNumber,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  /** Refund (full or partial, by line quantities). Creates a refund document; never rewrites the sale. */
  async refund(
    models: TenantModels,
    actorId: string,
    saleId: string,
    refundLines: { productId: string; qtyMilli: number }[],
    reason: string,
  ): Promise<{ refundId: string; refundNumber: string; refundTotalMinor: number }> {
    if (!isValidObjectId(saleId)) throw new BadRequestException('Invalid sale id');
    const sale = await models.sales.findById(saleId);
    if (!sale) throw new NotFoundException('Sale not found');
    if (sale.status === 'voided' || sale.status === 'refunded') {
      throw new ConflictException(`Sale already ${sale.status}`);
    }
    if (sale.refundOfSaleId) throw new ConflictException('Cannot refund a refund document');

    // Quantities already refunded for this sale
    const priorRefunds = await models.sales.find({ refundOfSaleId: saleId }).lean();
    const refundedByProduct = new Map<string, number>();
    for (const r of priorRefunds) {
      for (const l of r.lines) {
        refundedByProduct.set(l.productId, (refundedByProduct.get(l.productId) ?? 0) + l.qtyMilli);
      }
    }

    const lines = refundLines.map((rl) => {
      const orig = sale.lines.find((l) => l.productId === rl.productId);
      if (!orig) throw new BadRequestException(`Product not on sale: ${rl.productId}`);
      const already = refundedByProduct.get(rl.productId) ?? 0;
      if (rl.qtyMilli <= 0 || rl.qtyMilli + already > orig.qtyMilli) {
        throw new BadRequestException(`Refund quantity exceeds sold quantity for ${orig.sku}`);
      }
      // Proportional amounts using original pricing (historical integrity).
      const totals = computeLineTotals({
        qtyMilli: rl.qtyMilli,
        unitPriceMinor: orig.unitPriceMinor,
        discountMinor: Math.round((orig.discountMinor * rl.qtyMilli) / orig.qtyMilli),
        taxRateBps: orig.taxRateBps,
      });
      return {
        productId: orig.productId,
        sku: orig.sku,
        description: orig.description,
        qtyMilli: rl.qtyMilli,
        unitPriceMinor: orig.unitPriceMinor,
        discountMinor: totals.discountMinor,
        taxRateBps: orig.taxRateBps,
        grossMinor: totals.grossMinor,
        netMinor: totals.netMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
      };
    });

    const totals = computeSaleTotals(lines);
    const refundNumber = await this.nextSaleNumber(models, sale.branchId, 'refund');
    const refund = await models.sales.create({
      saleNumber: refundNumber,
      clientTxId: `refund:${saleId}:${refundNumber}`,
      branchId: sale.branchId,
      registerId: sale.registerId,
      cashierId: actorId,
      customerId: sale.customerId,
      lines,
      payments: [{ method: 'cash', amountMinor: -totals.totalMinor }],
      subtotalMinor: -totals.subtotalMinor,
      discountMinor: -totals.discountMinor,
      taxMinor: -totals.taxMinor,
      totalMinor: -totals.totalMinor,
      paidMinor: -totals.totalMinor,
      changeMinor: 0,
      status: 'completed',
      refundOfSaleId: saleId,
      offline: false,
      occurredAt: new Date(),
      syncWarnings: [],
      note: reason,
    });

    // Restock refunded items
    for (const line of lines) {
      const product = await models.products.findById(line.productId).lean();
      if (product?.trackInventory) {
        await this.inventory.applyMovement(models, {
          productId: line.productId,
          branchId: sale.branchId,
          qtyMilli: line.qtyMilli,
          type: 'refund',
          refType: 'refund',
          refId: String(refund._id),
          idempotencyKey: `refund:${refund._id}:${line.productId}`,
          createdBy: actorId,
        });
      }
    }

    // Update original sale status
    const totalRefundedQty = [...refundedByProduct.values()].reduce((a, b) => a + b, 0) +
      lines.reduce((a, l) => a + l.qtyMilli, 0);
    const totalSoldQty = sale.lines.reduce((a, l) => a + l.qtyMilli, 0);
    sale.status = totalRefundedQty >= totalSoldQty ? 'refunded' : 'partially_refunded';
    await sale.save();

    return {
      refundId: String(refund._id),
      refundNumber,
      refundTotalMinor: totals.totalMinor,
    };
  }

  private async deductStock(
    models: TenantModels,
    actorId: string,
    clientTxId: string,
    saleId: string,
    branchId: string,
    lines: Array<{ productId: string; qtyMilli: number; sku: string; trackInventory: boolean }>,
  ): Promise<string[]> {
    const warnings: string[] = [];
    for (const line of lines) {
      if (!line.trackInventory) continue;
      await this.inventory.applyMovement(models, {
        productId: line.productId,
        branchId,
        qtyMilli: -line.qtyMilli,
        type: 'sale',
        refType: 'sale',
        refId: saleId,
        idempotencyKey: `sale:${clientTxId}:${line.productId}`,
        createdBy: actorId,
      });
      const level = await this.inventory.currentLevel(models, line.productId, branchId);
      if (level < 0) {
        warnings.push(`Stock negative for ${line.sku} (now ${level / 1000})`);
      }
    }
    return warnings;
  }

  private async nextSaleNumber(
    models: TenantModels,
    branchId: string,
    kind: 'sale' | 'refund' = 'sale',
  ): Promise<string> {
    const key = `${kind}:${branchId}`;
    const counter = await models.counters.findOneAndUpdate(
      { key },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    const prefix = kind === 'refund' ? 'RF' : 'S';
    return `${prefix}-${String(counter.seq).padStart(8, '0')}`;
  }
}
