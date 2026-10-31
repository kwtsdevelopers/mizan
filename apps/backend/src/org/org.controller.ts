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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as bcrypt from 'bcryptjs';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { isValidObjectId } from 'mongoose';
import { Permission, TenantRole } from '@mizan/shared';
import { CurrentAuth, RequirePermissions } from '../auth/decorators';
import { AuthUser } from '../auth/auth-user';
import { TenantAccessService } from '../database/tenant-access.service';
import { AuditService } from '../audit/audit.service';

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(Object.values(TenantRole), { each: true })
  roles!: TenantRole[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  branchIds: string[] = [];
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(Object.values(TenantRole), { each: true })
  roles?: TenantRole[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  branchIds?: string[];

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';
}

class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  address?: string;
}

@ApiTags('organization')
@ApiBearerAuth()
@Controller('org')
export class OrgController {
  constructor(
    private readonly tenantAccess: TenantAccessService,
    private readonly audit: AuditService,
  ) {}

  @Get('branches')
  async branches(@CurrentAuth() user: AuthUser): Promise<unknown[]> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    return models.branches.find({ active: true }).sort({ name: 1 }).lean();
  }

  @Post('branches')
  @RequirePermissions(Permission.SettingsManage)
  async createBranch(@CurrentAuth() user: AuthUser, @Body() dto: CreateBranchDto): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    try {
      const branch = await models.branches.create({ ...dto, code: dto.code.toUpperCase(), active: true });
      return branch.toObject();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('Branch code already exists');
      }
      throw err;
    }
  }

  @Get('users')
  @RequirePermissions(Permission.UsersManage)
  async users(@CurrentAuth() user: AuthUser): Promise<unknown[]> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    return models.users
      .find()
      .select('email name roles branchIds status createdAt')
      .sort({ createdAt: 1 })
      .lean();
  }

  @Post('users')
  @RequirePermissions(Permission.UsersManage)
  async createUser(@CurrentAuth() user: AuthUser, @Body() dto: CreateUserDto): Promise<unknown> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    try {
      const created = await models.users.create({
        email: dto.email.toLowerCase(),
        passwordHash: await bcrypt.hash(dto.password, 12),
        name: dto.name,
        roles: dto.roles,
        branchIds: dto.branchIds,
        status: 'active',
        refreshTokenIds: [],
        failedLoginAttempts: 0,
      });
      await this.audit.record(models, {
        actorId: user.userId,
        action: 'user.created',
        entityType: 'user',
        entityId: String(created._id),
        details: { email: dto.email, roles: dto.roles },
      });
      const obj = created.toObject();
      const { passwordHash: _ph, refreshTokenIds: _rt, ...safe } = obj;
      return safe;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('Email already exists');
      }
      throw err;
    }
  }

  @Patch('users/:id')
  @RequirePermissions(Permission.UsersManage)
  async updateUser(
    @CurrentAuth() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<unknown> {
    if (!isValidObjectId(id)) throw new BadRequestException('Invalid id');
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    if (id === user.userId && dto.status === 'disabled') {
      throw new BadRequestException('You cannot disable your own account');
    }
    const update: Record<string, unknown> = { ...dto };
    if (dto.status === 'disabled') update['refreshTokenIds'] = []; // revoke sessions
    const updated = await models.users
      .findByIdAndUpdate(id, { $set: update }, { new: true })
      .select('email name roles branchIds status');
    if (!updated) throw new NotFoundException('User not found');
    await this.audit.record(models, {
      actorId: user.userId,
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      details: { fields: Object.keys(dto) },
    });
    return updated.toObject();
  }

  @Get('audit')
  @RequirePermissions(Permission.AuditRead)
  async auditLog(@CurrentAuth() user: AuthUser): Promise<unknown[]> {
    const models = await this.tenantAccess.modelsFor(user.tenantId!);
    return models.auditEvents.find().sort({ at: -1 }).limit(200).lean();
  }
}
