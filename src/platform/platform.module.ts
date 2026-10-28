import { Module } from '@nestjs/common';
import { PlatformService } from './platform.service';
import { ListingsController } from './platform.listings.controller';
import { ProfilesController } from './platform.profiles.controller';
import { RequestsController } from './platform.requests.controller';
import { UsersController } from './platform.users.controller';
import { StatsController } from './platform.stats.controller';
import { WalletController } from './platform.wallet.controller';
import { DatabaseService } from '../config/database';

@Module({
  controllers: [
    ListingsController,
    ProfilesController,
    RequestsController,
    UsersController,
    StatsController,
    WalletController,
  ],
  providers: [PlatformService, DatabaseService],
  exports: [PlatformService],
})
export class PlatformModule {}
