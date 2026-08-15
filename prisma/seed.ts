import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';

const SALT_ROUNDS = 10;

async function main() {
  const email = process.env.DEFAULT_RECRUITER_EMAIL;
  const password = process.env.DEFAULT_RECRUITER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'DEFAULT_RECRUITER_EMAIL and DEFAULT_RECRUITER_PASSWORD must be set in .env to seed a recruiter account',
    );
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.role === Role.RECRUITER) {
        console.log(
          `Recruiter account ${email} already exists — nothing to do.`,
        );
        return;
      }

      await prisma.user.update({
        where: { id: existing.id },
        data: { role: Role.RECRUITER },
      });
      console.log(`Updated existing user ${email} to RECRUITER.`);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: Role.RECRUITER,
        profile: { create: {} },
      },
    });

    console.log(`Created recruiter account: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
