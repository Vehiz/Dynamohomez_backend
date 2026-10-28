import { Body, Controller, ForbiddenException, Get, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformService } from './platform.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class RequestsController {
  constructor(
    @Inject(PlatformService)
    private readonly platformService: PlatformService,
  ) {}

  @Get('requests/:userId')
  async getRequests(@Req() req: Request, @Param('userId') userId: string) {
    const r = req as unknown as Record<string, unknown>;
    const requesterId = String(r.userId || '');
    const requesterRole = String(r.userRole || '');
    if (requesterRole !== 'admin' && requesterId !== userId) {
      throw new ForbiddenException('Not authorized to access these requests.');
    }

    const data = await this.platformService.getRequests(userId);
    return { success: true, data };
  }

  @Post('requests')
  async createRequest(
    @Req() req: Request,
    @Body()
    payload: {
      fromUserId: string;
      toUserId: string;
      type: 'roommate' | 'office';
      message?: string;
    },
  ) {
    const r = req as unknown as Record<string, unknown>;
    const requesterId = String(r.userId || '');
    const requesterRole = String(r.userRole || '');
    if (requesterRole !== 'admin' && payload.fromUserId !== requesterId) {
      throw new ForbiddenException('Not authorized to create a request for another user.');
    }

    const data = await this.platformService.createRequest({
      ...payload,
      fromUserId: requesterRole === 'admin' ? payload.fromUserId : requesterId,
    });
    return { success: true, data };
  }

  @Put('requests/:id')
  async updateRequestStatus(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() payload: { status: 'accepted' | 'rejected' },
  ) {
    const r = req as unknown as Record<string, unknown>;
    const data = await this.platformService.updateRequestStatus(
      id,
      payload.status,
      String(r.userId || ''),
      String(r.userRole || ''),
    );
    return { success: true, data };
  }

  @Get('roommate-requests/received/:userId')
  async getReceivedRoommateRequests(@Req() req: Request, @Param('userId') userId: string) {
    const r = req as unknown as Record<string, unknown>;
    const requesterId = String(r.userId || '');
    const requesterRole = String(r.userRole || '');
    if (requesterRole !== 'admin' && requesterId !== userId) {
      throw new ForbiddenException('Not authorized to access these requests.');
    }

    const data = await this.platformService.getReceivedRoommateRequests(userId);
    return { success: true, data };
  }

  @Post('housing-requests')
  async createHousingRequest(
    @Req() req: Request,
    @Body()
    payload: {
      requestType: 'ROOM' | 'ROOMMATE' | 'GROUP_RENTAL';
      city: string;
      state: string;
      area: string;
      budgetMin: number;
      budgetMax: number;
      bedrooms?: number;
      propertyType?: string;
      furnished?: 'furnished' | 'semi-furnished' | 'unfurnished' | 'any';
      moveInDate: string;
      duration?: string;
      propertyTypes?: string[];
      radiusKm?: number;
      lifestyle?: {
        sleepSchedule?: 'early' | 'normal' | 'late';
        noiseLevel?: number;
        guestsFrequency?: 'never' | 'rarely' | 'sometimes' | 'often';
        smokingAllowed?: boolean;
        petsAllowed?: boolean;
        genderPreference?: 'male' | 'female' | 'any';
        cleanliness?: number;
        socialLevel?: number;
      };
    },
  ) {
    const r = req as unknown as Record<string, unknown>;
    const userId = String(r.userId || '');
    const data = await this.platformService.createHousingRequest(payload, userId);
    return { success: true, data };
  }

  @Get('housing-requests/:userId')
  async getHousingRequests(@Req() req: Request, @Param('userId') userId: string) {
    const r = req as unknown as Record<string, unknown>;
    const requesterId = String(r.userId || '');
    const requesterRole = String(r.userRole || '');
    if (requesterRole !== 'admin' && requesterId !== userId) {
      throw new ForbiddenException('Not authorized to access these housing requests.');
    }

    const data = await this.platformService.getHousingRequests(userId);
    return { success: true, data };
  }

  @Get('matches/:userId')
  async getMatches(@Req() req: Request, @Param('userId') userId: string) {
    const r = req as unknown as Record<string, unknown>;
    const requesterId = String(r.userId || '');
    const requesterRole = String(r.userRole || '');
    if (requesterRole !== 'admin' && requesterId !== userId) {
      throw new ForbiddenException('Not authorized to access these matches.');
    }

    const data = await this.platformService.getMatches(userId);
    return { success: true, data };
  }
}
