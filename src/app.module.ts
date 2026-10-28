import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [HealthModule, AuthModule, PlatformModule],
})
export class AppModule {}
