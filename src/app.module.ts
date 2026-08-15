import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ArcjetGuard, ArcjetModule, shield, slidingWindow } from '@arcjet/nest';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ApiKeyMiddleware } from './middleware/api-key.middleware.js';
import { PrismaModule } from './lib/database/prisma.module.js';
import { CloudinaryModule } from './lib/cloudinary/cloudinary.module.js';
import { StripeModule } from './lib/stripe/stripe.module.js';
import { RedisModule } from './lib/redis/redis.module.js';
import { AuthModule } from './module/auth/auth.module.js';
import { UsersModule } from './module/users/users.module.js';
import { CompaniesModule } from './module/companies/companies.module.js';
import { JobsModule } from './module/jobs/jobs.module.js';
import { ApplicationsModule } from './module/applications/applications.module.js';
import { NotificationsModule } from './module/notifications/notifications.module.js';
import { PointsModule } from './module/points/points.module.js';
import { PaymentsModule } from './module/payments/payments.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    CloudinaryModule,
    StripeModule,
    RedisModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    JobsModule,
    ApplicationsModule,
    NotificationsModule,
    PointsModule,
    PaymentsModule,
    ArcjetModule.forRootAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        key: configService.getOrThrow<string>('ARCJET_KEY'),
        rules: [
          // Blocks common attacks e.g. SQL injection, XSS, etc.
          shield({ mode: 'LIVE' }),
          // Rate limit per IP: 4 requests per 60 second window
          slidingWindow({ mode: 'LIVE', max: 10, interval: '60s' }),
        ],
      }),
    }),
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ArcjetGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ApiKeyMiddleware)
      .exclude({ path: 'payments/stripe/webhook', method: RequestMethod.POST })
      .forRoutes('*');
  }
}
