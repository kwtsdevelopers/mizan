import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { EntitlementsGuard } from './entitlements.guard';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, PermissionsGuard, EntitlementsGuard],
  exports: [JwtModule, AuthService, JwtAuthGuard, PermissionsGuard, EntitlementsGuard],
})
export class AuthModule {}
