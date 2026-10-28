import { Controller, Get, Inject, InternalServerErrorException } from '@nestjs/common';
import { PlatformService } from './platform.service';

@Controller()
export class StatsController {
  constructor(
    @Inject(PlatformService)
    private readonly platformService: PlatformService,
  ) {}

  @Get('stats')
  async getStats() {
    if (!this.platformService) {
      throw new InternalServerErrorException('Stats service unavailable');
    }

    const data = await this.platformService.getStats();
    return { success: true, data };
  }
}
