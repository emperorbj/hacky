import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '../../../generated/prisma/enums.js';
import { ApplicationsService } from '../applications/applications.service.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JobsService } from './jobs.service.js';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly applicationsService: ApplicationsService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECRUITER)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateJobDto) {
    return this.jobsService.create(user.sub, dto);
  }

  @Get()
  findMany(@Query() query: JobQueryDto) {
    return this.jobsService.findMany(query);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECRUITER)
  findMine(@CurrentUser() user: JwtPayload) {
    return this.jobsService.findMine(user.sub);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECRUITER, Role.ADMIN)
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
  ) {
    return this.jobsService.update(id, user, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECRUITER, Role.ADMIN)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.jobsService.remove(id, user);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECRUITER, Role.ADMIN)
  publish(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.jobsService.publish(id, user);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECRUITER, Role.ADMIN)
  unpublish(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.jobsService.unpublish(id, user);
  }

  @Post(':id/apply')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.USER)
  apply(@CurrentUser() user: JwtPayload, @Param('id') jobId: string) {
    return this.applicationsService.apply(user.sub, jobId);
  }

  @Get(':id/applications')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECRUITER, Role.ADMIN)
  getApplicants(@CurrentUser() user: JwtPayload, @Param('id') jobId: string) {
    return this.applicationsService.findByJob(jobId, user);
  }
}
