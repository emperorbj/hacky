import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('stripe/webhook')
  @HttpCode(HttpStatus.OK)
  async handleStripeWebhook(@Req() request: RawBodyRequest<Request>) {
    const signature = request.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      throw new BadRequestException('Missing Stripe signature header');
    }
    if (!request.rawBody) {
      throw new BadRequestException('Missing raw request body');
    }

    await this.paymentsService.handleWebhookEvent(request.rawBody, signature);

    return { received: true };
  }
}
