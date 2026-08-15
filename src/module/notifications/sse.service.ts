import { Injectable, MessageEvent } from '@nestjs/common';
import { Subject } from 'rxjs';

@Injectable()
export class SseService {
  private readonly connections = new Map<string, Set<Subject<MessageEvent>>>();

  connect(userId: string): Subject<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const userConnections = this.connections.get(userId) ?? new Set();
    userConnections.add(subject);
    this.connections.set(userId, userConnections);
    return subject;
  }

  disconnect(userId: string, subject: Subject<MessageEvent>): void {
    this.connections.get(userId)?.delete(subject);
  }

  sendToUser(userId: string, event: MessageEvent): void {
    const userConnections = this.connections.get(userId);
    if (!userConnections) {
      return;
    }
    for (const subject of userConnections) {
      subject.next(event);
    }
  }
}
