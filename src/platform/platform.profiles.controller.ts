import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformService } from './platform.service';
import { JwtAuthGuard, JwtOptionalGuard } from '../auth/jwt.guard';

@Controller('profiles')
export class ProfilesController {
  constructor(
    @Inject(PlatformService)
    private readonly platformService: PlatformService,
  ) {}

  @Get()
  @UseGuards(JwtOptionalGuard)
  async getProfiles(
    @Req() req: Request,
    @Query('gender') gender?: string,
    @Query('minAge') minAge?: string,
    @Query('maxAge') maxAge?: string,
    @Query('minBudget') minBudget?: string,
    @Query('maxBudget') maxBudget?: string,
    @Query('location') location?: string,
  ) {
    const requestingUserId = (req as unknown as Record<string, unknown>).userId as string | undefined;
    const data = await this.platformService.getProfiles(
      {
        gender,
        minAge: minAge ? Number(minAge) : undefined,
        maxAge: maxAge ? Number(maxAge) : undefined,
        minBudget: minBudget ? Number(minBudget) : undefined,
        maxBudget: maxBudget ? Number(maxBudget) : undefined,
        location,
      },
      requestingUserId,
    );

    return { success: true, data };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyProfile(@Req() req: Request) {
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const data = await this.platformService.getProfileById(userId, userId);
    return { success: true, data };
  }

  @Get(':id')
  @UseGuards(JwtOptionalGuard)
  async getProfileById(@Req() req: Request, @Param('id') id: string) {
    const requestingUserId = (req as unknown as Record<string, unknown>).userId as string | undefined;
    const data = await this.platformService.getProfileById(id, requestingUserId);
    return { success: true, data };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async createProfile(@Req() req: Request, @Body() payload: Record<string, unknown>) {
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const data = await this.platformService.createProfile(payload, userId);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async updateProfile(@Req() req: Request, @Param('id') id: string, @Body() payload: Record<string, unknown>) {
    const r = req as unknown as Record<string, unknown>;
    const data = await this.platformService.updateProfile(
      id,
      payload,
      r.userId as string,
      r.userRole as string,
    );
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteProfile(@Req() req: Request, @Param('id') id: string) {
    const r = req as unknown as Record<string, unknown>;
    await this.platformService.deleteProfile(
      id,
      r.userId as string,
      r.userRole as string,
    );
    return { success: true, data: null };
  }
}
