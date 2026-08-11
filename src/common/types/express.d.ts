import { JwtPayload } from '../interfaces/jwt-payload.interface.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
