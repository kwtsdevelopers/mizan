import { Global, Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionsController } from './subscriptions.controller';

@Global()
@Module({
  controllers: [SubscriptionsController],
  providers: [EntitlementsService],
  exports: [EntitlementsService],
})
export class SubscriptionsModule {}
