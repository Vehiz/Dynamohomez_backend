import { Controller, Get, Inject } from '@nestjs/common';
import { DatabaseService } from '../config/database';
import { RedisService } from '../config/redis';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DatabaseService)
    private readonly databaseService: DatabaseService,
    @Inject(RedisService)
    private readonly redisService: RedisService,
  ) {}

  @Get()
  async getHealth() {
    const startedAt = Date.now();

    const [database, redis] = await Promise.allSettled([
      this.databaseService.ping(),
      this.redisService.ping(),
    ]);

    return {
      success: true,
      data: {
        status: database.status === 'fulfilled' && redis.status === 'fulfilled' ? 'ok' : 'degraded',
        services: {
          database: database.status === 'fulfilled' ? 'up' : 'down',
          redis: redis.status === 'fulfilled' ? 'up' : 'down',
        },
        uptimeMs: Date.now() - startedAt,
      },
    };
  }
}
