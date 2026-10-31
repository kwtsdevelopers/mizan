import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { TenantAccessService } from './tenant-access.service';

@Global()
@Module({
  providers: [DatabaseService, TenantAccessService],
  exports: [DatabaseService, TenantAccessService],
})
export class DatabaseModule {}
