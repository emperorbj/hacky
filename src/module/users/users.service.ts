import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProfileModel } from '../../../generated/prisma/models.js';
import { CloudinaryService } from '../../lib/cloudinary/cloudinary.service.js';
import { PrismaService } from '../../lib/database/prisma.service.js';
import { ReportUserDto } from './dto/report-user.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

const COMPLETION_FIELDS = 8;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async getMe(userId: string) {
    const profile = await this.prisma.profile.findUniqueOrThrow({
      where: { userId },
    });

    return {
      ...profile,
      completionPercentage: this.calculateCompletion(profile),
    };
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    const profile = await this.prisma.profile.update({
      where: { userId },
      data: dto,
    });

    return {
      ...profile,
      completionPercentage: this.calculateCompletion(profile),
    };
  }

  async uploadResume(userId: string, file: Express.Multer.File) {
    const existing = await this.prisma.profile.findUniqueOrThrow({
      where: { userId },
    });

    const { secureUrl, publicId } = await this.cloudinary.uploadBuffer(
      file.buffer,
      {
        folder: 'resumes',
        resourceType: 'raw',
      },
    );

    if (existing.resumePublicId) {
      await this.cloudinary.deleteAsset(existing.resumePublicId, 'raw');
    }

    const profile = await this.prisma.profile.update({
      where: { userId },
      data: { resumeUrl: secureUrl, resumePublicId: publicId },
    });

    return {
      ...profile,
      completionPercentage: this.calculateCompletion(profile),
    };
  }

  async uploadPhoto(userId: string, file: Express.Multer.File) {
    const existing = await this.prisma.profile.findUniqueOrThrow({
      where: { userId },
    });

    const { secureUrl, publicId } = await this.cloudinary.uploadBuffer(
      file.buffer,
      {
        folder: 'profile-photos',
        resourceType: 'image',
      },
    );

    if (existing.photoPublicId) {
      await this.cloudinary.deleteAsset(existing.photoPublicId, 'image');
    }

    const profile = await this.prisma.profile.update({
      where: { userId },
      data: { photoUrl: secureUrl, photoPublicId: publicId },
    });

    return {
      ...profile,
      completionPercentage: this.calculateCompletion(profile),
    };
  }

  async getPublicProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: {
        bio: true,
        location: true,
        skills: true,
        yearsOfExperience: true,
        education: true,
        portfolioLinks: true,
        photoUrl: true,
        user: { select: { id: true, role: true, createdAt: true } },
      },
    });

    if (!profile) {
      throw new NotFoundException('User not found');
    }

    return profile;
  }

  async reportUser(
    reporterId: string,
    reportedUserId: string,
    dto: ReportUserDto,
  ) {
    if (reporterId === reportedUserId) {
      throw new BadRequestException('You cannot report yourself');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: reportedUserId },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.report.create({
      data: { reporterId, reportedUserId, reason: dto.reason },
    });

    return { message: 'Report submitted' };
  }

  private calculateCompletion(profile: ProfileModel): number {
    const filledCount = [
      profile.bio,
      profile.location,
      profile.skills.length > 0 ? profile.skills : null,
      profile.yearsOfExperience,
      profile.education,
      profile.portfolioLinks.length > 0 ? profile.portfolioLinks : null,
      profile.resumeUrl,
      profile.photoUrl,
    ].filter((field) => field !== null && field !== undefined).length;

    return Math.round((filledCount / COMPLETION_FIELDS) * 100);
  }
}
