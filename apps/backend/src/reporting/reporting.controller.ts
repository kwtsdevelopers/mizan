import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ModuleId, Permission } from '@mizan/shared';
import { CurrentAuth, RequireModules, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth-user';
import { TenantAccessService } from '../database/tenant-access.service';

@ApiTags('reports')
@ApiBearerAuth()
@RequireModules(ModuleId.Reporting)
@RequirePermissions(Permission.ReportsRead)
@Controller('reports')
export class ReportingController {
  constructor(private readonly tenantAccess: TenantAccessService) {}

  /** Sales summary over a date range, grouped by day. */
  @Get('sales-summary')
  async salesSummary(
    @CurrentAuth() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const range = dateRange(from, to);
    const match: Record<string, unknown> = {
      occurredAt: { $gte: range.from, $lte: range.to },
      status: { $ne: 'voided' },
      refundOfSaleId: null,
    };
    if (branchId) match['branchId'] = branchId;

    const [byDay, totals, refunds] = await Promise.all([
      models.sales.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } },
            salesCount: { $sum: 1 },
            totalMinor: { $sum: '$totalMinor' },
            taxMinor: { $sum: '$taxMinor' },
            discountMinor: { $sum: '$discountMinor' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      models.sales.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            salesCount: { $sum: 1 },
            totalMinor: { $sum: '$totalMinor' },
            taxMinor: { $sum: '$taxMinor' },
            discountMinor: { $sum: '$discountMinor' },
            offlineCount: { $sum: { $cond: ['$offline', 1, 0] } },
          },
        },
      ]),
      models.sales.aggregate([
        {
          $match: {
            occurredAt: { $gte: range.from, $lte: range.to },
            refundOfSaleId: { $ne: null },
            ...(branchId ? { branchId } : {}),
          },
        },
        { $group: { _id: null, refundCount: { $sum: 1 }, refundTotalMinor: { $sum: '$totalMinor' } } },
      ]),
    ]);

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      totals: totals[0] ?? { salesCount: 0, totalMinor: 0, taxMinor: 0, discountMinor: 0, offlineCount: 0 },
      refunds: refunds[0] ?? { refundCount: 0, refundTotalMinor: 0 },
      byDay,
    };
  }

  /** Top products by revenue in a range. */
  @Get('top-products')
  async topProducts(
    @CurrentAuth() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit = '20',
  ): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const range = dateRange(from, to);
    const take = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    return models.sales.aggregate([
      {
        $match: {
          occurredAt: { $gte: range.from, $lte: range.to },
          status: { $ne: 'voided' },
          refundOfSaleId: null,
        },
      },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.productId',
          sku: { $first: '$lines.sku' },
          description: { $first: '$lines.description' },
          qtyMilli: { $sum: '$lines.qtyMilli' },
          revenueMinor: { $sum: '$lines.totalMinor' },
        },
      },
      { $sort: { revenueMinor: -1 } },
      { $limit: take },
    ]);
  }

  /** Items at/below reorder level. */
  @Get('low-stock')
  async lowStock(@CurrentAuth() user: AuthUser): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const products = await models.products
      .find({ status: 'active', trackInventory: true, reorderLevelMilli: { $gt: 0 } })
      .select('sku name unit reorderLevelMilli')
      .lean();
    if (products.length === 0) return [];
    const ids = products.map((p) => String(p._id));
    const levels = await models.stockLevels.find({ productId: { $in: ids } }).lean();
    const byProduct = new Map<string, number>();
    for (const l of levels) {
      byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + l.qtyMilli);
    }
    return products
      .map((p) => ({
        productId: String(p._id),
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        qtyMilli: byProduct.get(String(p._id)) ?? 0,
        reorderLevelMilli: p.reorderLevelMilli,
      }))
      .filter((p) => p.qtyMilli <= p.reorderLevelMilli);
  }
}

function dateRange(from?: string, to?: string): { from: Date; to: Date } {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 86_400_000);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new BadRequestException('Invalid date range');
  }
  return { from: fromDate, to: toDate };
}
