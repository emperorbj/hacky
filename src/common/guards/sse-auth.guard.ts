import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtPayload } from '../interfaces/jwt-payload.interface.js';

// Browsers' EventSource API cannot set an Authorization header, so the SSE
// endpoint alone needs to accept the token as a query param instead. This
// guard is deliberately a small, separate class rather than a modification
// to JwtAuthGuard, so that accepting a token via URL stays scoped to this
// one route instead of weakening every other endpoint's auth.
@Injectable()
export class SseAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.query.token;
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Missing access token');
    }

    try {
      request.user = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    return true;
  }
}
