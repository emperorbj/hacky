import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(configService: ConfigService) {
    this.client = new Redis(configService.getOrThrow<string>('REDIS_URL'));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /**
   * Cache-aside helper: returns the cached value for `key` if present,
   * otherwise calls `fetchFn`, caches its result for `ttlSeconds`, and
   * returns it. Redis failures degrade gracefully to calling `fetchFn`
   * directly — a cache outage should never break an otherwise-working
   * endpoint.
   */
  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    fetchFn: () => Promise<T>,
  ): Promise<T> {
    try {
      const cached = await this.client.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      this.logger.warn(`Redis GET failed for "${key}", using source: ${error}`);
    }

    const fresh = await fetchFn();

    try {
      await this.client.set(key, JSON.stringify(fresh), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Redis SET failed for "${key}": ${error}`);
    }

    return fresh;
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.warn(`Redis DEL failed for "${key}": ${error}`);
    }
  }

  /** Deletes every key matching `pattern` using SCAN (not the blocking KEYS command). */
  async deleteByPattern(pattern: string): Promise<void> {
    try {
      const stream = this.client.scanStream({ match: pattern, count: 100 });
      const pipeline = this.client.pipeline();
      let found = false;

      for await (const keys of stream as AsyncIterable<string[]>) {
        if (keys.length > 0) {
          found = true;
          for (const key of keys) {
            pipeline.del(key);
          }
        }
      }

      if (found) {
        await pipeline.exec();
      }
    } catch (error) {
      this.logger.warn(
        `Redis pattern delete failed for "${pattern}": ${error}`,
      );
    }
  }
}
