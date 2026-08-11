import { Role } from '../../../generated/prisma/enums.js';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}
