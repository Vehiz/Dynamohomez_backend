import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseService } from '../config/database';
import { RedisService } from '../config/redis';

@Module({
  controllers: [HealthController],
  providers: [DatabaseService, RedisService],
  exports: [DatabaseService, RedisService],
})
export class HealthModule {}
