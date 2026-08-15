import {
  Controller,
  Get,
  MessageEvent,
  Param,
  Patch,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { SseAuthGuard } from '../../common/guards/sse-auth.guard.js';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface.js';
import { NotificationsService } from './notifications.service.js';
import { SseService } from './sse.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly sseService: SseService,
  ) {}

  @Sse('stream')
  @UseGuards(SseAuthGuard)
  stream(
    @CurrentUser() user: JwtPayload,
    @Req() request: Request,
  ): Observable<MessageEvent> {
    const subject = this.sseService.connect(user.sub);
    request.on('close', () => this.sseService.disconnect(user.sub, subject));
    return subject.asObservable();
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  findMine(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.findMine(user.sub);
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  markAsRead(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notificationsService.markAsRead(id, user.sub);
  }
}
