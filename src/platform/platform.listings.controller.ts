import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformService } from './platform.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

const MVP_LISTING_TYPES = new Set(['shared', 'roommate', 'takeover']);

@Controller('listings')
export class ListingsController {
  constructor(
    @Inject(PlatformService)
    private readonly platformService: PlatformService,
  ) {}

  @Get()
  async getListings(
    @Query('type') type?: string,
    @Query('city') city?: string,
    @Query('area') area?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('bedrooms') bedrooms?: string,
    @Query('furnished') furnished?: string,
    @Query('availabilityStatus') availabilityStatus?: string,
    @Query('verified') verified?: string,
    @Query('search') search?: string,
  ) {
    if (type && !MVP_LISTING_TYPES.has(type)) {
      throw new BadRequestException('Only shared, roommate, and takeover listing types are supported in MVP.');
    }

    const data = await this.platformService.getListings({
      type,
      city,
      area,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      bedrooms: bedrooms ? Number(bedrooms) : undefined,
      furnished,
      availabilityStatus,
      verified: verified ? verified === 'true' : undefined,
      search,
    });
    return { success: true, data };
  }

  @Get(':id')
  async getListingById(@Param('id') id: string) {
    const data = await this.platformService.getListingById(id);
    return { success: true, data };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async createListing(@Req() req: Request, @Body() payload: Record<string, unknown>) {
    const listingType = String(payload.type || '');
    if (!MVP_LISTING_TYPES.has(listingType)) {
      throw new BadRequestException('Only shared, roommate, and takeover listing types are supported in MVP.');
    }

    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const data = await this.platformService.createListing(payload, userId);
    return { success: true, data };
  }

  @Post('verification-document')
  @UseGuards(JwtAuthGuard)
  async uploadVerificationDocument(
    @Req() req: Request,
    @Body() payload: { dataUrl: string; fileName: string; listingType: string },
  ) {
    if (!MVP_LISTING_TYPES.has(payload.listingType)) {
      throw new BadRequestException('Verification uploads are only supported for shared, roommate, and takeover listing types.');
    }

    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const data = await this.platformService.uploadListingVerificationDocument(userId, payload);
    return { success: true, data };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async updateListing(@Req() req: Request, @Param('id') id: string, @Body() payload: Record<string, unknown>) {
    if (payload.type) {
      const listingType = String(payload.type);
      if (!MVP_LISTING_TYPES.has(listingType)) {
        throw new BadRequestException('Only shared, roommate, and takeover listing types are supported in MVP.');
      }
    }

    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const data = await this.platformService.updateListing(id, payload, userId);
    return { success: true, data };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'property-owner', 'landlord')
  async deleteListing(@Param('id') id: string) {
    await this.platformService.deleteListing(id);
    return { success: true, data: null };
  }
}
