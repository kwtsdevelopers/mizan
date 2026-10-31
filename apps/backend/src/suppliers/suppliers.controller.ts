import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { isValidObjectId } from 'mongoose';
import { ModuleId, Permission } from '@mizan/shared';
import { CurrentAuth, RequireModules, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth-user';
import { TenantAccessService } from '../database/tenant-access.service';
import { Paginated, PaginationQueryDto } from '../common/pagination';

class SupplierDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  address?: string;
}

class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  address?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}

@ApiTags('suppliers')
@ApiBearerAuth()
@RequireModules(ModuleId.Suppliers)
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly tenantAccess: TenantAccessService) {}

  @Get()
  @RequirePermissions(Permission.SuppliersRead)
  async list(@CurrentAuth() user: AuthUser, @Query() query: PaginationQueryDto): Promise<Paginated<unknown>> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const filter: Record<string, unknown> = {};
    if (query.search) {
      const term = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter['name'] = { $regex: term, $options: 'i' };
    }
    const [items, total] = await Promise.all([
      models.suppliers
        .find(filter)
        .sort({ name: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
      models.suppliers.countDocuments(filter),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  @Post()
  @RequirePermissions(Permission.SuppliersWrite)
  async create(@CurrentAuth() user: AuthUser, @Body() dto: SupplierDto): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    try {
      const supplier = await models.suppliers.create({ ...dto, status: 'active' });
      return supplier.toObject();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('Supplier name already exists');
      }
      throw err;
    }
  }

  @Patch(':id')
  @RequirePermissions(Permission.SuppliersWrite)
  async update(
    @CurrentAuth() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<unknown> {
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid id');
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const updated = await models.suppliers.findByIdAndUpdate(id, { $set: { ...dto } }, { new: true });
    if (!updated) throw new NotFoundException('Supplier not found');
    return updated.toObject();
  }
}
