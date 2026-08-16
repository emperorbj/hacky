import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '../../../generated/prisma/enums.js';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface.js';
import { PrismaService } from '../../lib/database/prisma.service.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(recruiterId: string, dto: CreateCompanyDto) {
    const existing = await this.prisma.company.findUnique({
      where: { recruiterId },
    });
    if (existing) {
      throw new ConflictException('You already have a company profile');
    }

    return this.prisma.company.create({
      data: { ...dto, recruiterId },
    });
  }

  async findOne(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return company;
  }

  async findMine(recruiterId: string) {
    const company = await this.prisma.company.findUnique({
      where: { recruiterId },
    });
    if (!company) {
      throw new NotFoundException('You do not have a company profile yet');
    }
    return company;
  }

  async update(id: string, requester: JwtPayload, dto: UpdateCompanyDto) {
    const company = await this.findOne(id);

    const isOwner = company.recruiterId === requester.sub;
    const isAdmin = requester.role === Role.ADMIN;
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'You do not have permission to edit this company',
      );
    }

    return this.prisma.company.update({
      where: { id },
      data: dto,
    });
  }
}
