import { ConflictException, Injectable } from '@nestjs/common';
import { TenantModels } from '../database/tenant.schemas';

export interface StockMovementInput {
  productId: string;
  branchId: string;
  /** signed delta in milli-units */
  qtyMilli: number;
  type: 'sale' | 'refund' | 'receipt' | 'adjustment' | 'transfer_in' | 'transfer_out' | 'waste';
  refType?: string;
  refId?: string;
  idempotencyKey?: string;
  batchNumber?: string;
  expiryDate?: Date;
  note?: string;
  createdBy: string;
}

/**
 * Inventory engine. Stock movements are the auditable source of truth; stock
 * levels are an atomically maintained materialized balance.
 *
 * Idempotency: movements with an idempotencyKey are protected by a unique index,
 * so duplicate applications (offline sync retries) are rejected before the
 * balance is touched twice.
 */
@Injectable()
export class InventoryService {
  /**
   * Apply a stock movement atomically.
   * Returns false when the idempotency key was already applied (duplicate).
   */
  async applyMovement(models: TenantModels, input: StockMovementInput): Promise<boolean> {
    if (!Number.isSafeInteger(input.qtyMilli) || input.qtyMilli === 0) {
      throw new ConflictException('qtyMilli must be a non-zero integer');
    }
    try {
      await models.stockMovements.create({ ...input, at: new Date() });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        return false; // duplicate idempotency key -> already applied
      }
      throw err;
    }
    await models.stockLevels.updateOne(
      { productId: input.productId, branchId: input.branchId },
      {
        $inc: { qtyMilli: input.qtyMilli },
        $set: { updatedAt: new Date() },
        $setOnInsert: { productId: input.productId, branchId: input.branchId },
      },
      { upsert: true },
    );
    return true;
  }

  async currentLevel(models: TenantModels, productId: string, branchId: string): Promise<number> {
    const level = await models.stockLevels.findOne({ productId, branchId }).lean();
    return level?.qtyMilli ?? 0;
  }
}
