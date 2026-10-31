import {
  BadRequestException,
  Body,
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

class CustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

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
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

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
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}

@ApiTags('customers')
@ApiBearerAuth()
@RequireModules(ModuleId.Customers)
@Controller('customers')
export class CustomersController {
  constructor(private readonly tenantAccess: TenantAccessService) {}

  @Get()
  @RequirePermissions(Permission.CustomersRead)
  async list(@CurrentAuth() user: AuthUser, @Query() query: PaginationQueryDto): Promise<Paginated<unknown>> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const filter: Record<string, unknown> = {};
    if (query.search) {
      const term = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter['$or'] = [
        { name: { $regex: term, $options: 'i' } },
        { phone: { $regex: `^${term}` } },
      ];
    }
    const [items, total] = await Promise.all([
      models.customers
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
      models.customers.countDocuments(filter),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  @Post()
  @RequirePermissions(Permission.CustomersWrite)
  async create(@CurrentAuth() user: AuthUser, @Body() dto: CustomerDto): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const customer = await models.customers.create({ ...dto, status: 'active' });
    return customer.toObject();
  }

  @Patch(':id')
  @RequirePermissions(Permission.CustomersWrite)
  async update(
    @CurrentAuth() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<unknown> {
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid id');
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    const updated = await models.customers.findByIdAndUpdate(id, { $set: { ...dto } }, { new: true });
    if (!updated) throw new NotFoundException('Customer not found');
    return updated.toObject();
  }
}
