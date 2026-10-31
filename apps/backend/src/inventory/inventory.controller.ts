import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  NotEquals,
} from 'class-validator';
import { isValidObjectId } from 'mongoose';
import { randomUUID } from 'crypto';
import { ModuleId, Permission } from '@mizan/shared';
import { CurrentAuth, RequireModules, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth-user';
import { TenantAccessService } from '../database/tenant-access.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from './inventory.service';
import { Paginated, PaginationQueryDto } from '../common/pagination';

class AdjustStockDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  branchId!: string;

  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  qtyMilli!: number;

  @IsIn(['adjustment', 'waste'])
  type: 'adjustment' | 'waste' = 'adjustment';

  @IsOptional()
  @IsString()
  @MaxLength(400)
  note?: string;
}

class LevelsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  branchId?: string;
}

class MovementsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  productId?: string;
}

@ApiTags('inventory')
@ApiBearerAuth()
@RequireModules(ModuleId.Inventory)
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly tenantAccess: TenantAccessService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  @Get('levels')
  @RequirePermissions(Permission.InventoryRead)
  async levels(
    @CurrentAuth() user: AuthUser,
    @Query() query: LevelsQueryDto,
  ): Promise<Paginated<unknown>> {
    const branchId = query.branchId;
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const filter: Record<string, unknown> = {};
    if (branchId) filter['branchId'] = branchId;
    const [items, total] = await Promise.all([
      models.stockLevels
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
      models.stockLevels.countDocuments(filter),
    ]);

    // join product names (bounded page size keeps this cheap)
    const productIds = items.map((i) => i.productId).filter((id) => isValidObjectId(id));
    const products = await models.products
      .find({ _id: { $in: productIds } })
      .select('name sku unit kind reorderLevelMilli')
      .lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const enriched = items.map((i) => ({ ...i, product: byId.get(i.productId) ?? null }));
    return { items: enriched, total, page: query.page, pageSize: query.pageSize };
  }

  @Get('movements')
  @RequirePermissions(Permission.InventoryRead)
  async movements(
    @CurrentAuth() user: AuthUser,
    @Query() query: MovementsQueryDto,
  ): Promise<Paginated<unknown>> {
    const productId = query.productId;
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const filter: Record<string, unknown> = {};
    if (productId) filter['productId'] = productId;
    const [items, total] = await Promise.all([
      models.stockMovements
        .find(filter)
        .sort({ at: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
      models.stockMovements.countDocuments(filter),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  @Post('adjustments')
  @RequirePermissions(Permission.InventoryWrite)
  async adjust(@CurrentAuth() user: AuthUser, @Body() dto: AdjustStockDto): Promise<{ ok: true; newQtyMilli: number }> {
    if (!isValidObjectId(dto.productId)) throw new BadRequestException('Invalid productId');
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const product = await models.products.findById(dto.productId).lean();
    if (!product) throw new BadRequestException('Product not found');

    await this.inventory.applyMovement(models, {
      productId: dto.productId,
      branchId: dto.branchId,
      qtyMilli: dto.qtyMilli,
      type: dto.type,
      note: dto.note,
      idempotencyKey: `adj:${randomUUID()}`,
      createdBy: user.userId,
    });
    const newQtyMilli = await this.inventory.currentLevel(models, dto.productId, dto.branchId);
    await this.audit.record(models, {
      actorId: user.userId,
      action: 'inventory.adjusted',
      entityType: 'product',
      entityId: dto.productId,
      details: { qtyMilli: dto.qtyMilli, type: dto.type, note: dto.note },
    });
    return { ok: true, newQtyMilli };
  }

  @Get('levels/:productId/:branchId')
  @RequirePermissions(Permission.InventoryRead)
  async level(
    @CurrentAuth() user: AuthUser,
    @Param('productId') productId: string,
    @Param('branchId') branchId: string,
  ): Promise<{ qtyMilli: number }> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    return { qtyMilli: await this.inventory.currentLevel(models, productId, branchId) };
  }
}
