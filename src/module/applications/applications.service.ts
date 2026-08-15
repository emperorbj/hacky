import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApplicationStatus,
  JobStatus,
  Role,
} from '../../../generated/prisma/enums.js';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface.js';
import { PrismaService } from '../../lib/database/prisma.service.js';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto.js';

const APPLICATION_INCLUDE = {
  job: { include: { company: true } },
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
};

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async apply(candidateId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.status !== JobStatus.PUBLISHED) {
      throw new NotFoundException('Job not found');
    }

    const existing = await this.prisma.application.findUnique({
      where: { candidateId_jobId: { candidateId, jobId } },
    });
    if (existing) {
      throw new ConflictException('You have already applied to this job');
    }

    return this.prisma.application.create({
      data: {
        candidateId,
        jobId,
        statusHistory: {
          create: { actorId: candidateId, toStatus: ApplicationStatus.APPLIED },
        },
      },
      include: APPLICATION_INCLUDE,
    });
  }

  async findMine(candidateId: string) {
    return this.prisma.application.findMany({
      where: { candidateId },
      include: APPLICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByJob(jobId: string, requester: JwtPayload) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { company: true },
    });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const isOwningRecruiter = job.company.recruiterId === requester.sub;
    const isAdmin = requester.role === Role.ADMIN;
    if (!isOwningRecruiter && !isAdmin) {
      throw new ForbiddenException(
        'You do not have permission to view applicants for this job',
      );
    }

    return this.prisma.application.findMany({
      where: { jobId },
      include: {
        candidate: {
          select: {
            id: true,
            email: true,
            role: true,
            createdAt: true,
            profile: {
              select: {
                bio: true,
                location: true,
                skills: true,
                yearsOfExperience: true,
                education: true,
                portfolioLinks: true,
                resumeUrl: true,
                photoUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, requester: JwtPayload) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: APPLICATION_INCLUDE,
    });
    if (!application) {
      throw new NotFoundException('Application not found');
    }

    const isCandidate = application.candidateId === requester.sub;
    const isOwningRecruiter =
      application.job.company.recruiterId === requester.sub;
    const isAdmin = requester.role === Role.ADMIN;
    if (!isCandidate && !isOwningRecruiter && !isAdmin) {
      throw new ForbiddenException(
        'You do not have permission to view this application',
      );
    }

    return application;
  }

  async updateStatus(
    id: string,
    requester: JwtPayload,
    dto: UpdateApplicationStatusDto,
  ) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: { job: { include: { company: true } } },
    });
    if (!application) {
      throw new NotFoundException('Application not found');
    }

    const isOwningRecruiter =
      application.job.company.recruiterId === requester.sub;
    const isAdmin = requester.role === Role.ADMIN;
    if (!isOwningRecruiter && !isAdmin) {
      throw new ForbiddenException(
        'You do not have permission to update this application',
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.application.update({
        where: { id },
        data: {
          status: dto.status,
          interviewMeetingLink:
            dto.meetingLink ?? application.interviewMeetingLink,
        },
      }),
      this.prisma.applicationStatusHistory.create({
        data: {
          applicationId: id,
          actorId: requester.sub,
          fromStatus: application.status,
          toStatus: dto.status,
        },
      }),
    ]);

    this.eventEmitter.emit('application.status_changed', {
      applicationId: updated.id,
      candidateId: application.candidateId,
      jobTitle: application.job.title,
      status: updated.status,
      meetingLink: updated.interviewMeetingLink,
    });

    return updated;
  }
}
