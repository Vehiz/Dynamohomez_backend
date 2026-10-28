import { Controller, Delete, ForbiddenException, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformService } from './platform.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@Controller('users')
export class UsersController {
  constructor(
    @Inject(PlatformService)
    private readonly platformService: PlatformService,
  ) {}

  private ensureUserAccess(req: Request, userId: string): void {
    const requesterId = (req as unknown as Record<string, unknown>).userId as string | undefined;
    if (!requesterId || requesterId !== userId) {
      throw new ForbiddenException('Not authorized to access this user resource.');
    }
  }

  @Get(':userId/saved')
  @UseGuards(JwtAuthGuard)
  async getSavedListings(@Req() req: Request, @Param('userId') userId: string) {
    this.ensureUserAccess(req, userId);
    const data = await this.platformService.getSavedListings(userId);
    return { success: true, data };
  }

  @Post(':userId/saved/:listingId')
  @UseGuards(JwtAuthGuard)
  async saveListing(@Req() req: Request, @Param('userId') userId: string, @Param('listingId') listingId: string) {
    this.ensureUserAccess(req, userId);
    const data = await this.platformService.saveListing(userId, listingId);
    return { success: true, data };
  }

  @Delete(':userId/saved/:listingId')
  @UseGuards(JwtAuthGuard)
  async unsaveListing(@Req() req: Request, @Param('userId') userId: string, @Param('listingId') listingId: string) {
    this.ensureUserAccess(req, userId);
    const data = await this.platformService.unsaveListing(userId, listingId);
    return { success: true, data };
  }

  @Delete(':userId')
  @UseGuards(JwtAuthGuard)
  async deleteUser(@Req() req: Request, @Param('userId') userId: string) {
    const r = req as unknown as Record<string, unknown>;
    const requesterId = String(r.userId || '');
    const requesterRole = String(r.userRole || '');
    if (requesterRole !== 'admin' && requesterId !== userId) {
      throw new ForbiddenException('Not authorized to delete this user.');
    }

    await this.platformService.deleteUser(userId);
    return { success: true, data: null };
  }
}
