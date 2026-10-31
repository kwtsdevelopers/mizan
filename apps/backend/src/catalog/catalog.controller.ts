import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { isValidObjectId } from 'mongoose';
import { ModuleId, Permission } from '@mizan/shared';
import { CurrentAuth, RequireModules, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth-user';
import { TenantAccessService } from '../database/tenant-access.service';
import { AuditService } from '../audit/audit.service';
import { Paginated, PaginationQueryDto } from '../common/pagination';

class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_\-.]+$/)
  sku!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  barcodes: string[] = [];

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  name!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsIn(['standard', 'weighted'])
  kind: 'standard' | 'weighted' = 'standard';

  @IsString()
  @MaxLength(16)
  unit = 'pc';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceMinor!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  costMinor = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  taxRateBps = 0;

  @IsOptional()
  @IsBoolean()
  trackInventory = true;

  @IsOptional()
  @IsBoolean()
  batchTracking = false;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderLevelMilli = 0;
}

class UpdateProductDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  barcodes?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  name?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceMinor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  costMinor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  taxRateBps?: number;

  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;

  @IsOptional()
  @IsBoolean()
  batchTracking?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reorderLevelMilli?: number;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}

class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

class ListProductsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: string;
}

@ApiTags('catalog')
@ApiBearerAuth()
@RequireModules(ModuleId.Catalog)
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly tenantAccess: TenantAccessService,
    private readonly audit: AuditService,
  ) {}

  @Get('products')
  @RequirePermissions(Permission.CatalogRead)
  async listProducts(
    @CurrentAuth() user: AuthUser,
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<unknown>> {
    const status = query.status;
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const filter: Record<string, unknown> = {};
    if (status === 'active' || status === 'archived') filter['status'] = status;
    if (query.search) {
      const term = escapeRegex(query.search);
      filter['$or'] = [
        { name: { $regex: term, $options: 'i' } },
        { sku: { $regex: `^${term}`, $options: 'i' } },
        { barcodes: query.search },
      ];
    }
    const [items, total] = await Promise.all([
      models.products
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
      models.products.countDocuments(filter),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** Fast barcode/SKU lookup for POS. */
  @Get('products/lookup/:code')
  @RequirePermissions(Permission.CatalogRead)
  async lookup(@CurrentAuth() user: AuthUser, @Param('code') code: string): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const product = await models.products
      .findOne({ status: 'active', $or: [{ barcodes: code }, { sku: code }] })
      .lean();
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  @Get('products/:id')
  @RequirePermissions(Permission.CatalogRead)
  async getProduct(@CurrentAuth() user: AuthUser, @Param('id') id: string): Promise<unknown> {
    assertObjectId(id);
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const product = await models.products.findById(id).lean();
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  @Post('products')
  @RequirePermissions(Permission.CatalogWrite)
  async createProduct(@CurrentAuth() user: AuthUser, @Body() dto: CreateProductDto): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    try {
      const product = await models.products.create({ ...dto, status: 'active', version: 1 });
      await this.audit.record(models, {
        actorId: user.userId,
        action: 'product.created',
        entityType: 'product',
        entityId: String(product._id),
        details: { sku: dto.sku },
      });
      return product.toObject();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('SKU already exists');
      }
      throw err;
    }
  }

  @Patch('products/:id')
  @RequirePermissions(Permission.CatalogWrite)
  async updateProduct(
    @CurrentAuth() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<unknown> {
    assertObjectId(id);
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const updated = await models.products.findByIdAndUpdate(
      id,
      { $set: { ...dto }, $inc: { version: 1 } },
      { new: true, runValidators: true },
    );
    if (!updated) throw new NotFoundException('Product not found');
    await this.audit.record(models, {
      actorId: user.userId,
      action: 'product.updated',
      entityType: 'product',
      entityId: id,
      details: { fields: Object.keys(dto) },
    });
    return updated.toObject();
  }

  /** Archive (never hard-delete) to preserve sale history integrity. */
  @Delete('products/:id')
  @RequirePermissions(Permission.CatalogWrite)
  async archiveProduct(@CurrentAuth() user: AuthUser, @Param('id') id: string): Promise<{ ok: true }> {
    assertObjectId(id);
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const res = await models.products.updateOne({ _id: id }, { $set: { status: 'archived' } });
    if (res.matchedCount === 0) throw new NotFoundException('Product not found');
    await this.audit.record(models, {
      actorId: user.userId,
      action: 'product.archived',
      entityType: 'product',
      entityId: id,
    });
    return { ok: true };
  }

  @Get('categories')
  @RequirePermissions(Permission.CatalogRead)
  async listCategories(@CurrentAuth() user: AuthUser): Promise<unknown[]> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    return models.categories.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean();
  }

  @Post('categories')
  @RequirePermissions(Permission.CatalogWrite)
  async createCategory(@CurrentAuth() user: AuthUser, @Body() dto: CreateCategoryDto): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    try {
      const cat = await models.categories.create({
        name: dto.name,
        parentId: dto.parentId ?? null,
        sortOrder: 0,
        active: true,
      });
      return cat.toObject();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('Category already exists');
      }
      throw err;
    }
  }
}

function assertObjectId(id: string): void {
  if (!isValidObjectId(id)) throw new BadRequestException('Invalid id');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
