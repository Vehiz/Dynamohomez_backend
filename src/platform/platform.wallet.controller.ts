import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformService } from './platform.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('wallet')
export class WalletController {
  constructor(
    @Inject(PlatformService)
    private readonly platformService: PlatformService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getWallet(@Req() req: Request) {
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const data = await this.platformService.getWallet(userId);
    return { success: true, data };
  }

  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  async getTransactions(@Req() req: Request) {
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const data = await this.platformService.getWalletTransactions(userId);
    return { success: true, data };
  }

  @Post('top-up')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async topUp(
    @Req() req: Request,
    @Body() body: { nairaAmount: number; reference?: string },
  ) {
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const data = await this.platformService.topUpWallet(userId, body.nairaAmount, body.reference);
    return { success: true, data };
  }

  @Post('spend')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async spend(
    @Req() req: Request,
    @Body() body: { action: string; targetId: string },
  ) {
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const data = await this.platformService.spendWallet(userId, body.action, body.targetId);
    return { success: true, data };
  }
}
