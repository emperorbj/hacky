import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

@Module({
  imports: [ApplicationsModule],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
