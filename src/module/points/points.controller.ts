import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface.js';
import { PaymentsService } from '../payments/payments.service.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import { PointsService } from './points.service.js';

@Controller('points')
export class PointsController {
  constructor(
    private readonly pointsService: PointsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Get('packages')
  getPackages() {
    return this.pointsService.getPackages();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: JwtPayload) {
    return this.pointsService.getMe(user.sub);
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@CurrentUser() user: JwtPayload, @Body() dto: CheckoutDto) {
    const pointPackage = this.pointsService.findPackageOrThrow(dto.packageId);
    return this.paymentsService.createCheckoutSession(user.sub, pointPackage);
  }

  @Get('transactions/:reference')
  @UseGuards(JwtAuthGuard)
  getTransaction(
    @CurrentUser() user: JwtPayload,
    @Param('reference') reference: string,
  ) {
    return this.paymentsService.reconcileTransaction(reference, user.sub);
  }
}
