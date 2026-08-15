import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../lib/database/prisma.service.js';
import { calculateBadge } from './badge.js';
import { POINT_PACKAGES, PointPackage } from './point-packages.constant.js';

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  getPackages(): readonly PointPackage[] {
    return POINT_PACKAGES;
  }

  findPackageOrThrow(packageId: string): PointPackage {
    const pointPackage = POINT_PACKAGES.find((pkg) => pkg.id === packageId);
    if (!pointPackage) {
      throw new NotFoundException('Unknown package');
    }
    return pointPackage;
  }

  async getMe(userId: string) {
    const transactions = await this.prisma.pointsTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const totalPoints = transactions
      .filter((transaction) => transaction.status === PaymentStatus.COMPLETED)
      .reduce((sum, transaction) => sum + transaction.points, 0);

    return {
      totalPoints,
      badge: calculateBadge(totalPoints),
      transactions,
    };
  }
}
