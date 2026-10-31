import {
  BadRequestException,
  Body,
  ConflictException,
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
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { isValidObjectId } from 'mongoose';
import { lineGross, ModuleId, Permission } from '@mizan/shared';
import { CurrentAuth, RequireModules, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth-user';
import { TenantAccessService } from '../database/tenant-access.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuditService } from '../audit/audit.service';
import { Paginated, PaginationQueryDto } from '../common/pagination';

class PoLineDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qtyMilli!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  unitCostMinor!: number;
}

class CreatePoDto {
  @IsString()
  @IsNotEmpty()
  supplierId!: string;

  @IsString()
  @IsNotEmpty()
  branchId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PoLineDto)
  lines!: PoLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

class ReceiveLineDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qtyMilli!: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  batchNumber?: string;

  @IsOptional()
  @IsString()
  expiryDate?: string;
}

class ReceiveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];
}

class ListOrdersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;
}

@ApiTags('purchasing')
@ApiBearerAuth()
@RequireModules(ModuleId.Purchasing)
@Controller('purchasing')
export class PurchasingController {
  constructor(
    private readonly tenantAccess: TenantAccessService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  @Get('orders')
  @RequirePermissions(Permission.PurchasingRead)
  async list(
    @CurrentAuth() user: AuthUser,
    @Query() query: ListOrdersQueryDto,
  ): Promise<Paginated<unknown>> {
    const status = query.status;
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const filter: Record<string, unknown> = {};
    if (status) filter['status'] = status;
    const [items, total] = await Promise.all([
      models.purchaseOrders
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
      models.purchaseOrders.countDocuments(filter),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  @Post('orders')
  @RequirePermissions(Permission.PurchasingWrite)
  async create(@CurrentAuth() user: AuthUser, @Body() dto: CreatePoDto): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    if (!isValidObjectId(dto.supplierId)) throw new BadRequestException('Invalid supplierId');
    const supplier = await models.suppliers.findById(dto.supplierId).lean();
    if (!supplier || supplier.status !== 'active') throw new BadRequestException('Supplier not found');

    const productIds = dto.lines.map((l) => l.productId);
    if (productIds.some((id) => !isValidObjectId(id))) {
      throw new BadRequestException('Invalid product id');
    }
    const products = await models.products.find({ _id: { $in: productIds } }).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    let totalMinor = 0;
    const lines = dto.lines.map((l) => {
      const product = byId.get(l.productId);
      if (!product) throw new BadRequestException(`Product not found: ${l.productId}`);
      totalMinor += lineGross(l.qtyMilli, l.unitCostMinor);
      return {
        productId: l.productId,
        sku: product.sku,
        description: product.name,
        qtyMilli: l.qtyMilli,
        unitCostMinor: l.unitCostMinor,
        receivedQtyMilli: 0,
      };
    });

    const counter = await models.counters.findOneAndUpdate(
      { key: 'po' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    const poNumber = `PO-${String(counter.seq).padStart(6, '0')}`;

    const po = await models.purchaseOrders.create({
      poNumber,
      supplierId: dto.supplierId,
      branchId: dto.branchId,
      status: 'ordered',
      lines,
      totalMinor,
      note: dto.note,
      createdBy: user.userId,
    });
    await this.audit.record(models, {
      actorId: user.userId,
      action: 'purchase_order.created',
      entityType: 'purchase_order',
      entityId: String(po._id),
      details: { poNumber, totalMinor },
    });
    return po.toObject();
  }

  /** Goods receipt against a PO: increments stock and received quantities. */
  @Post('orders/:id/receive')
  @RequirePermissions(Permission.PurchasingWrite)
  async receive(
    @CurrentAuth() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReceiveDto,
  ): Promise<unknown> {
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid id');
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const po = await models.purchaseOrders.findById(id);
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'canceled' || po.status === 'received') {
      throw new ConflictException(`Purchase order is ${po.status}`);
    }

    for (const line of dto.lines) {
      const poLine = po.lines.find((l) => l.productId === line.productId);
      if (!poLine) throw new BadRequestException(`Product not on PO: ${line.productId}`);
      if (poLine.receivedQtyMilli + line.qtyMilli > poLine.qtyMilli) {
        throw new BadRequestException(`Receiving more than ordered for ${poLine.sku}`);
      }
      const expiryDate = line.expiryDate ? new Date(line.expiryDate) : undefined;
      if (line.expiryDate && Number.isNaN(expiryDate?.getTime())) {
        throw new BadRequestException('Invalid expiryDate');
      }
      await this.inventory.applyMovement(models, {
        productId: line.productId,
        branchId: po.branchId,
        qtyMilli: line.qtyMilli,
        type: 'receipt',
        refType: 'purchase_order',
        refId: String(po._id),
        idempotencyKey: `grn:${po._id}:${line.productId}:${poLine.receivedQtyMilli + line.qtyMilli}`,
        batchNumber: line.batchNumber,
        expiryDate,
        createdBy: user.userId,
      });
      poLine.receivedQtyMilli += line.qtyMilli;
      // Update product cost to latest received cost (simple last-cost valuation)
      await models.products.updateOne(
        { _id: line.productId },
        { $set: { costMinor: poLine.unitCostMinor } },
      );
    }

    const fullyReceived = po.lines.every((l) => l.receivedQtyMilli >= l.qtyMilli);
    po.status = fullyReceived ? 'received' : 'partially_received';
    await po.save();

    await this.audit.record(models, {
      actorId: user.userId,
      action: 'goods.received',
      entityType: 'purchase_order',
      entityId: id,
      details: { lines: dto.lines.length, status: po.status },
    });
    return po.toObject();
  }
}
