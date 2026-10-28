import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseService } from '../config/database';
import { RedisService } from '../config/redis';

@Module({
  controllers: [AuthController],
  providers: [AuthService, DatabaseService, RedisService],
  exports: [AuthService],
})
export class AuthModule {}
