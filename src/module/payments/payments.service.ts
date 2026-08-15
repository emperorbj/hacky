import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import {
  PaymentProvider,
  PaymentStatus,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../lib/database/prisma.service.js';
import { StripeService } from '../../lib/stripe/stripe.service.js';
import { PointPackage } from '../points/point-packages.constant.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
  ) {}

  async createCheckoutSession(userId: string, pointPackage: PointPackage) {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');

    const session = await this.stripeService.client.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: pointPackage.amountCents,
            product_data: { name: pointPackage.name },
          },
          quantity: 1,
        },
      ],
      success_url: `${frontendUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/checkout/cancel`,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    await this.prisma.pointsTransaction.create({
      data: {
        userId,
        provider: PaymentProvider.STRIPE,
        providerReference: session.id,
        packageId: pointPackage.id,
        points: pointPackage.points,
        amount: pointPackage.amountCents,
        currency: 'usd',
      },
    });

    return { checkoutUrl: session.url };
  }

  async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;
    try {
      event = this.stripeService.client.webhooks.constructEvent(
        rawBody,
        signature,
        this.stripeService.webhookSecret,
      );
    } catch {
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    if (event.type !== 'checkout.session.completed') {
      return;
    }

    const session = event.data.object;

    const updated = await this.prisma.pointsTransaction.updateMany({
      where: { providerReference: session.id, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.COMPLETED },
    });

    if (updated.count === 0) {
      this.logger.warn(
        `Webhook for unknown or already-processed session ${session.id}`,
      );
    }
  }

  async reconcileTransaction(reference: string, userId: string) {
    const transaction = await this.prisma.pointsTransaction.findUnique({
      where: { providerReference: reference },
    });
    if (!transaction || transaction.userId !== userId) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.status !== PaymentStatus.PENDING) {
      return transaction;
    }

    // Still pending as far as our own webhook has told us — ask Stripe
    // directly rather than waiting, in case the webhook is delayed or lost.
    const session =
      await this.stripeService.client.checkout.sessions.retrieve(reference);

    if (session.payment_status !== 'paid') {
      return transaction;
    }

    return this.prisma.pointsTransaction.update({
      where: { id: transaction.id },
      data: { status: PaymentStatus.COMPLETED },
    });
  }
}
