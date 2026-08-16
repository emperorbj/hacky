import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '../../../generated/prisma/client.js';
import { JobStatus, Role } from '../../../generated/prisma/enums.js';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface.js';
import { PrismaService } from '../../lib/database/prisma.service.js';
import { RedisService } from '../../lib/redis/redis.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';

const JOB_LIST_CACHE_TTL_SECONDS = 60;
const JOB_DETAIL_CACHE_TTL_SECONDS = 300;
const JOB_LIST_CACHE_PATTERN = 'jobs:list:*';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly redisService: RedisService,
  ) {}

  async create(recruiterId: string, dto: CreateJobDto) {
    const company = await this.prisma.company.findUnique({
      where: { recruiterId },
    });
    if (!company) {
      throw new NotFoundException(
        'Create a company profile before posting a job',
      );
    }

    const job = await this.prisma.job.create({
      data: { ...dto, companyId: company.id },
    });

    await this.invalidateJobCaches(job.id);

    return job;
  }

  async findMany(query: JobQueryDto) {
    const cacheKey = this.buildJobListCacheKey(query);

    return this.redisService.getOrSet(
      cacheKey,
      JOB_LIST_CACHE_TTL_SECONDS,
      async () => {
        const where: Prisma.JobWhereInput = { status: JobStatus.PUBLISHED };

        if (query.keyword) {
          where.OR = [
            { title: { contains: query.keyword, mode: 'insensitive' } },
            { description: { contains: query.keyword, mode: 'insensitive' } },
          ];
        }

        if (query.skills && query.skills.length > 0) {
          where.skills = { hasSome: query.skills };
        }

        if (query.location) {
          where.location = { contains: query.location, mode: 'insensitive' };
        }

        if (query.employmentType) {
          where.employmentType = query.employmentType;
        }

        if (query.workMode) {
          where.workMode = query.workMode;
        }

        if (query.experienceLevel) {
          where.experienceLevel = query.experienceLevel;
        }

        if (query.salaryMin !== undefined) {
          where.salaryRangeMax = { gte: query.salaryMin };
        }

        if (query.salaryMax !== undefined) {
          where.salaryRangeMin = { lte: query.salaryMax };
        }

        return this.prisma.job.findMany({
          where,
          orderBy: { createdAt: 'desc' },
        });
      },
    );
  }

  async findMine(recruiterId: string) {
    const company = await this.prisma.company.findUnique({
      where: { recruiterId },
    });
    if (!company) {
      return [];
    }

    return this.prisma.job.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const job = await this.redisService.getOrSet(
      `jobs:detail:${id}`,
      JOB_DETAIL_CACHE_TTL_SECONDS,
      () => this.prisma.job.findUnique({ where: { id } }),
    );

    if (!job) {
      throw new NotFoundException('Job not found');
    }
    return job;
  }

  async update(id: string, requester: JwtPayload, dto: UpdateJobDto) {
    await this.findJobWithOwnerCheck(id, requester);

    const job = await this.prisma.job.update({
      where: { id },
      data: dto,
    });

    await this.invalidateJobCaches(id);

    return job;
  }

  async remove(id: string, requester: JwtPayload) {
    await this.findJobWithOwnerCheck(id, requester);

    await this.prisma.job.delete({ where: { id } });

    await this.invalidateJobCaches(id);

    return { message: 'Job deleted' };
  }

  // Bare-bones v1: just flips status. Once BullMQ + AI job analysis exist
  // (PRD §7), this should also enqueue an "analyze-job" job instead of
  // only updating this one field.
  async publish(id: string, requester: JwtPayload) {
    await this.findJobWithOwnerCheck(id, requester);

    const job = await this.prisma.job.update({
      where: { id },
      data: { status: JobStatus.PUBLISHED },
    });

    this.eventEmitter.emit('job.published', job);

    await this.invalidateJobCaches(id);

    return job;
  }

  async unpublish(id: string, requester: JwtPayload) {
    await this.findJobWithOwnerCheck(id, requester);

    const job = await this.prisma.job.update({
      where: { id },
      data: { status: JobStatus.UNPUBLISHED },
    });

    await this.invalidateJobCaches(id);

    return job;
  }

  private async findJobWithOwnerCheck(id: string, requester: JwtPayload) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: { company: true },
    });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const isOwner = job.company.recruiterId === requester.sub;
    const isAdmin = requester.role === Role.ADMIN;
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'You do not have permission to modify this job',
      );
    }

    return job;
  }

  private buildJobListCacheKey(query: JobQueryDto): string {
    const entries = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null)
      .sort(([a], [b]) => a.localeCompare(b));
    return `jobs:list:${JSON.stringify(entries)}`;
  }

  private async invalidateJobCaches(id: string): Promise<void> {
    await this.redisService.del(`jobs:detail:${id}`);
    await this.redisService.deleteByPattern(JOB_LIST_CACHE_PATTERN);
  }
}
