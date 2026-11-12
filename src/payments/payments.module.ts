import { Module } from '@nestjs/common';
import { MockPaymentProvider } from './payment-provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, MockPaymentProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
