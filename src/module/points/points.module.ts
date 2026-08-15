import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { PointsController } from './points.controller.js';
import { PointsService } from './points.service.js';

@Module({
  imports: [PaymentsModule],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
