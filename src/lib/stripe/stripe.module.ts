import { Global, Module } from '@nestjs/common';
import { StripeService } from './stripe.service.js';

@Global()
@Module({
  providers: [StripeService],
  exports: [StripeService],
})
export class StripeModule {}
