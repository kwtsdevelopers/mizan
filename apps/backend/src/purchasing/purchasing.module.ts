import { Module } from '@nestjs/common';
import { PurchasingController } from './purchasing.controller';

@Module({
  controllers: [PurchasingController],
})
export class PurchasingModule {}
