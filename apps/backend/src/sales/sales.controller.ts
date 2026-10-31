import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { isValidObjectId } from 'mongoose';
import { ModuleId, Permission, SyncResponse } from '@mizan/shared';
import { CurrentAuth, RequireModules, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth-user';
import { TenantAccessService } from '../database/tenant-access.service';
import { AuditService } from '../audit/audit.service';
import { CheckoutResult, SalesService } from './sales.service';
import { Paginated, PaginationQueryDto } from '../common/pagination';

class CheckoutLineDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qtyMilli!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  discountMinor = 0;
}

class PaymentDto {
  @IsIn(['cash', 'card', 'other'])
  method!: 'cash' | 'card' | 'other';

  @Type(() => Number)
  @IsInt()
  amountMinor!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

class CheckoutDto {
  @IsString()
  @Matches(/^[A-Za-z0-9:_-]{8,80}$/)
  clientTxId!: string;

  @IsString()
  @IsNotEmpty()
  branchId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  registerId = 'default';

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineDto)
  lines!: CheckoutLineDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PaymentDto)
  payments!: PaymentDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class OfflineSaleLineDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sku!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qtyMilli!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitPriceMinor!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  discountMinor = 0;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  taxRateBps = 0;
}

class OfflineSaleDto {
  @IsString()
  @Matches(/^[A-Za-z0-9:_-]{8,80}$/)
  clientTxId!: string;

  @IsString()
  @IsNotEmpty()
  branchId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  registerId!: string;

  @IsISO8601()
  occurredAt!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OfflineSaleLineDto)
  lines!: OfflineSaleLineDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PaymentDto)
  payments!: PaymentDto[];

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

class SyncDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OfflineSaleDto)
  sales!: OfflineSaleDto[];
}

class RefundLineDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qtyMilli!: number;
}

class RefundDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RefundLineDto)
  lines!: RefundLineDto[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  reason!: string;
}

class OpenSessionDto {
  @IsString()
  @IsNotEmpty()
  branchId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  registerId = 'default';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  openingFloatMinor!: number;
}

class ListSalesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

class CloseSessionDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedCashMinor!: number;
}

@ApiTags('sales')
@ApiBearerAuth()
@RequireModules(ModuleId.Sales)
@Controller('sales')
export class SalesController {
  constructor(
    private readonly tenantAccess: TenantAccessService,
    private readonly sales: SalesService,
    private readonly audit: AuditService,
  ) {}

  @Post('checkout')
  @RequirePermissions(Permission.SalesCheckout)
  async checkout(@CurrentAuth() user: AuthUser, @Body() dto: CheckoutDto): Promise<CheckoutResult> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const result = await this.sales.checkout(models, user.userId, dto);
    if (!result.duplicate) {
      await this.audit.record(models, {
        actorId: user.userId,
        action: 'sale.completed',
        entityType: 'sale',
        entityId: result.saleId,
        details: { saleNumber: result.saleNumber, totalMinor: result.totalMinor },
      });
    }
    return result;
  }

  @Post('sync')
  @RequireModules(ModuleId.Sales, ModuleId.OfflinePos)
  @RequirePermissions(Permission.SalesSync)
  async sync(@CurrentAuth() user: AuthUser, @Body() dto: SyncDto): Promise<SyncResponse> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const results = await this.sales.syncOfflineSales(models, user.userId, dto.sales);
    await this.audit.record(models, {
      actorId: user.userId,
      action: 'sales.synced',
      details: {
        submitted: dto.sales.length,
        applied: results.filter((r) => r.status === 'applied').length,
        duplicates: results.filter((r) => r.status === 'duplicate').length,
        rejected: results.filter((r) => r.status === 'rejected').length,
      },
    });
    return { results, serverTime: new Date().toISOString() };
  }

  @Get()
  @RequirePermissions(Permission.SalesRead)
  async list(
    @CurrentAuth() user: AuthUser,
    @Query() query: ListSalesQueryDto,
  ): Promise<Paginated<unknown>> {
    const { branchId, from, to } = query;
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const filter: Record<string, unknown> = {};
    if (branchId) filter['branchId'] = branchId;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range['$gte'] = parseDate(from, 'from');
      if (to) range['$lte'] = parseDate(to, 'to');
      filter['occurredAt'] = range;
    }
    const [items, total] = await Promise.all([
      models.sales
        .find(filter)
        .sort({ occurredAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
      models.sales.countDocuments(filter),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  @Get(':id')
  @RequirePermissions(Permission.SalesRead)
  async get(@CurrentAuth() user: AuthUser, @Param('id') id: string): Promise<unknown> {
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid id');
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const sale = await models.sales.findById(id).lean();
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  @Post(':id/refund')
  @RequirePermissions(Permission.SalesRefund)
  async refund(
    @CurrentAuth() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RefundDto,
  ): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const result = await this.sales.refund(models, user.userId, id, dto.lines, dto.reason);
    await this.audit.record(models, {
      actorId: user.userId,
      action: 'sale.refunded',
      entityType: 'sale',
      entityId: id,
      details: { ...result, reason: dto.reason },
    });
    return result;
  }

  // ---- cashier sessions (cash management) ----

  @Post('sessions/open')
  @RequireModules(ModuleId.Sales, ModuleId.CashManagement)
  @RequirePermissions(Permission.CashSessionManage)
  async openSession(@CurrentAuth() user: AuthUser, @Body() dto: OpenSessionDto): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const existing = await models.cashierSessions.findOne({ cashierId: user.userId, status: 'open' });
    if (existing) throw new BadRequestException('A session is already open for this cashier');
    const session = await models.cashierSessions.create({
      cashierId: user.userId,
      branchId: dto.branchId,
      registerId: dto.registerId,
      openingFloatMinor: dto.openingFloatMinor,
      status: 'open',
      openedAt: new Date(),
    });
    return session.toObject();
  }

  @Post('sessions/close')
  @RequireModules(ModuleId.Sales, ModuleId.CashManagement)
  @RequirePermissions(Permission.CashSessionManage)
  async closeSession(@CurrentAuth() user: AuthUser, @Body() dto: CloseSessionDto): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const session = await models.cashierSessions.findOne({ cashierId: user.userId, status: 'open' });
    if (!session) throw new NotFoundException('No open session');

    // Expected cash = opening float + cash payments on sales during the session
    const cashAgg = await models.sales.aggregate<{ _id: null; cash: number }>([
      {
        $match: {
          cashierId: user.userId,
          occurredAt: { $gte: session.openedAt },
          status: { $ne: 'voided' },
        },
      },
      { $unwind: '$payments' },
      { $match: { 'payments.method': 'cash' } },
      { $group: { _id: null, cash: { $sum: '$payments.amountMinor' } } },
    ]);
    const cashCollected = cashAgg[0]?.cash ?? 0;
    const changeAgg = await models.sales.aggregate<{ _id: null; change: number }>([
      {
        $match: {
          cashierId: user.userId,
          occurredAt: { $gte: session.openedAt },
          status: { $ne: 'voided' },
        },
      },
      { $group: { _id: null, change: { $sum: '$changeMinor' } } },
    ]);
    const changeGiven = changeAgg[0]?.change ?? 0;
    const expectedCashMinor = session.openingFloatMinor + cashCollected - changeGiven;

    session.closedAt = new Date();
    session.countedCashMinor = dto.countedCashMinor;
    session.expectedCashMinor = expectedCashMinor;
    session.varianceMinor = dto.countedCashMinor - expectedCashMinor;
    session.status = 'closed';
    await session.save();

    await this.audit.record(models, {
      actorId: user.userId,
      action: 'cash_session.closed',
      entityType: 'cashier_session',
      entityId: String(session._id),
      details: {
        expectedCashMinor,
        countedCashMinor: dto.countedCashMinor,
        varianceMinor: session.varianceMinor,
      },
    });
    return session.toObject();
  }

  @Get('sessions/current')
  @RequireModules(ModuleId.Sales, ModuleId.CashManagement)
  @RequirePermissions(Permission.CashSessionManage)
  async currentSession(@CurrentAuth() user: AuthUser): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const session = await models.cashierSessions
      .findOne({ cashierId: user.userId, status: 'open' })
      .lean();
    return session ?? { status: 'none' };
  }
}

function parseDate(value: string, label: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${label}`);
  return d;
}
