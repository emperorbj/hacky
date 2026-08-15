import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JobModel } from '../../../generated/prisma/models.js';
import { NotificationType, Role } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../lib/database/prisma.service.js';
import { ApplicationStatusChangedEvent } from './events/application-status-changed.event.js';
import { SseService } from './sse.service.js';

@Injectable()
export class NotificationsListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sseService: SseService,
  ) {}

  @OnEvent('job.published')
  async handleJobPublished(job: JobModel): Promise<void> {
    const candidates = await this.prisma.user.findMany({
      where: { role: Role.USER },
      select: { id: true },
    });

    if (candidates.length === 0) {
      return;
    }

    await this.prisma.notification.createMany({
      data: candidates.map((candidate) => ({
        userId: candidate.id,
        type: NotificationType.JOB_PUBLISHED,
        title: 'New job posted',
        message: `A new job was posted: "${job.title}"`,
        metadata: { jobId: job.id },
      })),
    });

    // SSE push carries the full job (same shape GET /jobs/:id returns) so a
    // connected client can render it immediately with no follow-up request.
    for (const candidate of candidates) {
      this.sseService.sendToUser(candidate.id, {
        type: 'job_published',
        data: job,
      });
    }
  }

  @OnEvent('application.status_changed')
  async handleApplicationStatusChanged(
    payload: ApplicationStatusChangedEvent,
  ): Promise<void> {
    const notification = await this.prisma.notification.create({
      data: {
        userId: payload.candidateId,
        type: NotificationType.APPLICATION_STATUS_CHANGED,
        title: 'Application update',
        message: `Your application for "${payload.jobTitle}" is now ${payload.status}`,
        metadata: {
          applicationId: payload.applicationId,
          status: payload.status,
          meetingLink: payload.meetingLink ?? null,
        },
      },
    });

    this.sseService.sendToUser(payload.candidateId, {
      type: 'application_status_changed',
      data: notification,
    });
  }
}
