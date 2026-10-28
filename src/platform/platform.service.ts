import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, resolve } from 'path';
import { HousingRequestRecord, ListingImageRecord, ListingRecord, MatchRecord, ProfileRecord, PropertyRecord, PropertyUnitRecord, RequestRecord } from './platform.types';
import { DatabaseService } from '../config/database';

@Injectable()
export class PlatformService {
  private schemaInitPromise: Promise<void> | null = null;
  private static readonly NAIRA_PER_POINT = 100;
  private static readonly TOP_UP_BONUS_POINTS: Record<number, number> = {
    1000: 0,
    5000: 5,
    10000: 20,
    20000: 60,
  };

  constructor(
    @Inject(DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private async ensureSchemaReady(): Promise<void> {
    if (!this.schemaInitPromise) {
      this.schemaInitPromise = this.initializeSchema();
    }
    await this.schemaInitPromise;
  }

  private async initializeSchema(): Promise<void> {
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_properties (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_property_units (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_listing_images (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        storage_key TEXT NOT NULL,
        url TEXT NOT NULL,
        type TEXT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_property_verifications (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL,
        submitted_by TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_listings (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_profiles (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Add user_id column to app_profiles (idempotent — existing rows get NULL)
    await this.databaseService.query(`
      ALTER TABLE app_profiles ADD COLUMN IF NOT EXISTS user_id TEXT
    `);

    // Partial unique index so NULL rows are unrestricted but non-null user_ids are unique
    await this.databaseService.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS app_profiles_user_id_unique
        ON app_profiles (user_id)
        WHERE user_id IS NOT NULL
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_requests (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_housing_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_matches (
        id TEXT PRIMARY KEY,
        source_user_id TEXT NOT NULL,
        target_user_id TEXT,
        property_id TEXT,
        listing_id TEXT,
        housing_request_id TEXT,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_saved_listings (
        user_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, listing_id)
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_reviews (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_reports (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_verifications (
        user_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Wallet balances — one row per auth user
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_wallets (
        user_id TEXT PRIMARY KEY,
        balance INT NOT NULL DEFAULT 0
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_wallet_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_listing_verification_documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        listing_id TEXT,
        listing_type TEXT NOT NULL,
        purpose TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Tracks which auth users have unlocked which profile owners.
    // profile_id stores the profile owner's auth user ID (profile.user_id),
    // not the profile row ID, so the unlock survives profile recreation.
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_unlocked_profiles (
        user_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, profile_id)
      )
    `);

    const profilesCount = await this.databaseService.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM app_profiles',
    );

    if (Number(profilesCount[0]?.count ?? 0) === 0) {
      const sampleProfile: ProfileRecord = {
        id: 'user-1',
        name: 'Chinedu Okafor',
        age: 29,
        gender: 'male',
        occupation: 'professional',
        bio: 'Software engineer looking for clean and quiet shared spaces.',
        avatar: '',
        email: 'chinedu@example.com',
        phone: '+2348030000001',
        role: 'tenant',
        roles: ['tenant'],
        preferences: {
          budget: { min: 300000, max: 900000 },
          location: ['Lekki', 'Yaba'],
          genderPreference: 'any',
          ageRange: { min: 24, max: 36 },
          moveInDate: new Date().toISOString(),
          lifestyle: ['quiet', 'clean'],
          cleanliness: 4,
          socialLevel: 3,
          petsAllowed: false,
          smokingAllowed: false,
        },
        verified: true,
        isVerified: true,
      };

      // Seed with no user_id (legacy row)
      await this.databaseService.query(
        'INSERT INTO app_profiles (id, data) VALUES ($1, $2::jsonb)',
        [sampleProfile.id, JSON.stringify(sampleProfile)],
      );
    }
  }

  async getListings(filters: {
    type?: string;
    city?: string;
    area?: string;
    minPrice?: number;
    maxPrice?: number;
    bedrooms?: number;
    furnished?: string;
    availabilityStatus?: string;
    verified?: boolean;
    search?: string;
  }): Promise<ListingRecord[]> {
    await this.ensureSchemaReady();
    const rows = await this.databaseService.query<{ data: ListingRecord }>(
      'SELECT data FROM app_listings ORDER BY created_at DESC',
    );
    const listings = rows.map((row) => row.data);
    const query = String(filters.search || '').trim().toLowerCase();

    return listings.filter((listing) => {
      if (filters.type && filters.type !== 'all' && listing.type !== filters.type) return false;
      if (filters.city && listing.location.city !== filters.city) return false;
      if (filters.area && listing.location.area !== filters.area) return false;
      if (typeof filters.minPrice === 'number' && listing.price < filters.minPrice) return false;
      if (typeof filters.maxPrice === 'number' && listing.price > filters.maxPrice) return false;
      if (typeof filters.bedrooms === 'number' && listing.bedrooms !== filters.bedrooms) return false;
      if (filters.furnished && filters.furnished !== 'all' && listing.furnished !== filters.furnished) return false;
      if (filters.availabilityStatus && filters.availabilityStatus !== 'all' && listing.availabilityStatus !== filters.availabilityStatus) return false;
      if (typeof filters.verified === 'boolean' && listing.verified !== filters.verified) return false;
      if (
        query &&
        ![
          listing.title,
          listing.description,
          listing.location.city,
          listing.location.area,
          listing.location.state,
          listing.posterName,
          listing.property?.title,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      ) {
        return false;
      }
      return true;
    });
  }

  async getListingById(id: string): Promise<ListingRecord> {
    await this.ensureSchemaReady();
    const rows = await this.databaseService.query<{ data: ListingRecord }>(
      'SELECT data FROM app_listings WHERE id = $1 LIMIT 1',
      [id],
    );
    const listing = rows[0]?.data;
    if (!listing) throw new NotFoundException('Listing not found');
    const images = await this.loadListingImages(id);
    const property = listing.propertyId ? await this.getPropertyById(listing.propertyId) : null;
    const propertyUnit = listing.unitId ? await this.getPropertyUnitById(listing.unitId) : null;

    return {
      ...listing,
      images: images.length > 0 ? images.map((image) => image.url) : listing.images,
      ...(property ? { property } : {}),
      ...(propertyUnit ? { propertyUnit } : {}),
      propertyVerificationStatus: property?.verificationStatus ?? listing.propertyVerificationStatus,
    };
  }

  private async getPropertyById(id: string): Promise<PropertyRecord | null> {
    const rows = await this.databaseService.query<{ data: PropertyRecord }>(
      'SELECT data FROM app_properties WHERE id = $1 LIMIT 1',
      [id],
    );
    return rows[0]?.data || null;
  }

  private async getPropertyUnitById(id: string): Promise<PropertyUnitRecord | null> {
    const rows = await this.databaseService.query<{ data: PropertyUnitRecord }>(
      'SELECT data FROM app_property_units WHERE id = $1 LIMIT 1',
      [id],
    );
    return rows[0]?.data || null;
  }

  private async loadListingImages(listingId: string): Promise<ListingImageRecord[]> {
    const rows = await this.databaseService.query<{ id: string; listing_id: string; storage_key: string; url: string; type: string; sort_order: number; created_at: string }>(
      'SELECT id, listing_id, storage_key, url, type, sort_order, created_at FROM app_listing_images WHERE listing_id = $1 ORDER BY sort_order ASC, created_at ASC',
      [listingId],
    );

    return rows.map((row) => ({
      id: row.id,
      listingId: row.listing_id,
      storageKey: row.storage_key,
      url: row.url,
      type: row.type,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
    }));
  }

  private async replaceListingImages(listingId: string, imageUrls: string[]): Promise<void> {
    await this.databaseService.query('DELETE FROM app_listing_images WHERE listing_id = $1', [listingId]);

    for (const [index, url] of imageUrls.entries()) {
      await this.databaseService.query(
        `INSERT INTO app_listing_images (id, listing_id, storage_key, url, type, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), listingId, `listing-images/${listingId}/${index}`, url, index === 0 ? 'cover' : 'gallery', index],
      );
    }
  }

  private toPropertyVerificationStatus(value?: string | null): PropertyRecord['verificationStatus'] {
    const normalized = String(value || 'unverified').toLowerCase();
    if (normalized === 'verified') return 'verified';
    if (normalized === 'pending' || normalized === 'in-review') return 'in-review';
    if (normalized === 'rejected') return 'rejected';
    if (normalized === 'expired') return 'expired';
    return 'unverified';
  }

  private async syncPropertyArtifacts(listing: ListingRecord, userId: string): Promise<ListingRecord> {
    const propertyId = listing.propertyId || randomUUID();
    const unitId = listing.unitId || randomUUID();
    const property = listing.property || {
      id: propertyId,
      ownerId: userId,
      propertyType: listing.type === 'shared' ? 'shared-apartment' : listing.type === 'roommate' ? 'room' : 'apartment',
      title: listing.title,
      description: listing.description,
      address: listing.location.address,
      city: listing.location.city,
      state: listing.location.state,
      lga: undefined,
      area: listing.location.area,
      latitude: undefined,
      longitude: undefined,
      verificationStatus: this.toPropertyVerificationStatus(listing.listingVerificationStatus),
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const propertyUnit = listing.propertyUnit || {
      id: unitId,
      propertyId,
      unitType: listing.type === 'shared' ? 'shared-room' : listing.type === 'roommate' ? 'room' : 'full-property',
      name: listing.type === 'roommate' ? 'Available Room' : listing.title,
      bedroomCount: listing.bedrooms,
      bathroomCount: listing.bathrooms,
      rent: listing.price,
      serviceCharge: 0,
      deposit: 0,
      availabilityStatus: listing.availabilityStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.databaseService.query(
      `INSERT INTO app_properties (id, owner_id, data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id, data = EXCLUDED.data, updated_at = NOW()`,
      [propertyId, userId, JSON.stringify(property)],
    );

    await this.databaseService.query(
      `INSERT INTO app_property_units (id, property_id, data)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO UPDATE SET property_id = EXCLUDED.property_id, data = EXCLUDED.data, updated_at = NOW()`,
      [unitId, propertyId, JSON.stringify(propertyUnit)],
    );

    await this.replaceListingImages(listing.id, listing.images || []);

    return {
      ...listing,
      propertyId,
      unitId,
      ...(property ? { property } : {}),
      ...(propertyUnit ? { propertyUnit } : {}),
      propertyVerificationStatus: property.verificationStatus,
      images: listing.images || [],
    };
  }

  private getListingVerificationDir(): string {
    return resolve(__dirname, '../../private_uploads/listing-verification');
  }

  private isVerificationListingType(listingType: string): boolean {
    return listingType === 'shared' || listingType === 'roommate' || listingType === 'takeover' || listingType === 'spare-room';
  }

  private parseVerificationDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer; extension: string } {
    const match = dataUrl.match(/^data:(application\/pdf|image\/jpeg|image\/jpg|image\/png);base64,(.+)$/);
    if (!match) {
      throw new HttpException('Unsupported verification document format.', HttpStatus.BAD_REQUEST);
    }

    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
      throw new HttpException('Verification document must be between 1 byte and 5MB.', HttpStatus.BAD_REQUEST);
    }

    const extensionMap: Record<string, string> = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
    };

    return { mimeType, buffer, extension: extensionMap[mimeType] };
  }

  private async attachVerificationDocumentToListing(
    userId: string,
    listingId: string,
    listingType: string,
    verificationDocumentId?: string,
  ): Promise<boolean> {
    if (!this.isVerificationListingType(listingType)) {
      return false;
    }

    if (!verificationDocumentId) {
      throw new HttpException('Government-issued ID is required for shared apartment and roommate listings.', HttpStatus.BAD_REQUEST);
    }

    const rows = await this.databaseService.query<{ id: string }>(
      `UPDATE app_listing_verification_documents
         SET listing_id = $2, updated_at = NOW()
       WHERE id = $1 AND user_id = $3 AND listing_type = $4 AND purpose = 'government-id'
       RETURNING id`,
      [verificationDocumentId, listingId, userId, listingType],
    );

    if (rows.length === 0) {
      throw new HttpException('Uploaded government ID could not be linked to this listing.', HttpStatus.BAD_REQUEST);
    }

    return true;
  }

  async uploadListingVerificationDocument(
    userId: string,
    payload: { dataUrl: string; fileName: string; listingType: string },
  ): Promise<{ documentId: string; fileName: string }> {
    await this.ensureSchemaReady();

    if (!this.isVerificationListingType(payload.listingType)) {
      throw new HttpException('Government ID uploads are not supported for this listing type.', HttpStatus.BAD_REQUEST);
    }

    const parsed = this.parseVerificationDataUrl(payload.dataUrl);
    const documentId = randomUUID();
    const uploadsDir = this.getListingVerificationDir();
    await mkdir(uploadsDir, { recursive: true });

    const safeBaseName = (payload.fileName || 'government-id')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-');
    const originalExtension = extname(safeBaseName);
    const resolvedExtension = originalExtension || parsed.extension;
    const filePath = resolve(uploadsDir, `${documentId}${resolvedExtension}`);

    await writeFile(filePath, parsed.buffer);

    await this.databaseService.query(
      `INSERT INTO app_listing_verification_documents
        (id, user_id, listing_id, listing_type, purpose, file_name, mime_type, file_path, status)
       VALUES ($1, $2, NULL, $3, 'government-id', $4, $5, $6, 'pending')`,
      [documentId, userId, payload.listingType, safeBaseName, parsed.mimeType, filePath],
    );

    return { documentId, fileName: safeBaseName };
  }

  async createListing(input: Record<string, unknown>, userId: string): Promise<ListingRecord> {
    await this.ensureSchemaReady();
    const listingInput = input as Partial<ListingRecord> & { verificationDocumentId?: string };
    const listingId = randomUUID();
    const listingType = String(listingInput.type || 'rent');

    if ((listingType === 'shared' || listingType === 'roommate' || listingType === 'spare-room') && !listingInput.location?.address) {
      throw new HttpException('Full property address is required for shared apartment and roommate listings.', HttpStatus.BAD_REQUEST);
    }

    const hostVerificationSubmitted =
      this.isVerificationListingType(listingType)
        ? await this.attachVerificationDocumentToListing(userId, listingId, listingType, listingInput.verificationDocumentId)
        : false;

    const listing: ListingRecord = {
      id: listingId,
      propertyId: typeof listingInput.propertyId === 'string' ? listingInput.propertyId : undefined,
      unitId: typeof listingInput.unitId === 'string' ? listingInput.unitId : undefined,
      title: listingInput.title || 'Untitled listing',
      type: listingInput.type || 'rent',
      category: listingInput.category || 'residential',
      price: Number(listingInput.price ?? 0),
      priceType: listingInput.priceType || 'monthly',
      location: listingInput.location || { state: '', city: '', area: '', address: '' },
      bedrooms: Number(listingInput.bedrooms ?? 0),
      bathrooms: Number(listingInput.bathrooms ?? 0),
      size: Number(listingInput.size ?? 0),
      furnished: listingInput.furnished || 'unfurnished',
      utilitiesIncluded: listingInput.utilitiesIncluded || {
        electricity: false,
        water: false,
        internet: false,
        security: false,
        gas: false,
      },
      images: listingInput.images || [],
      amenities: listingInput.amenities || [],
      description: listingInput.description || '',
      availableFrom: listingInput.availableFrom || new Date().toISOString(),
      availabilityStatus: listingInput.availabilityStatus || 'available',
      postedDate: new Date().toISOString(),
      postedBy: listingInput.postedBy || 'owner',
      posterName: listingInput.posterName || 'Anonymous',
      posterContact: listingInput.posterContact || '',
      verified: Boolean(listingInput.verified),
      listingVerificationStatus: hostVerificationSubmitted ? 'pending' : (listingInput.listingVerificationStatus || 'unverified'),
      hostVerificationSubmitted,
      propertyVerificationStatus: hostVerificationSubmitted ? 'pending' : 'unverified',
    };

    const listingWithArtifacts = await this.syncPropertyArtifacts(listing, userId);

    await this.databaseService.query(
      'INSERT INTO app_listings (id, data) VALUES ($1, $2::jsonb)',
      [listingWithArtifacts.id, JSON.stringify(listingWithArtifacts)],
    );

    return listingWithArtifacts;
  }

  async updateListing(id: string, updates: Record<string, unknown>, userId: string): Promise<ListingRecord> {
    const existing = await this.getListingById(id);
    const updateInput = updates as Partial<ListingRecord> & { verificationDocumentId?: string };
    const merged: ListingRecord = {
      ...existing,
      ...(updates as Partial<ListingRecord>),
      id,
    };

    if ((merged.type === 'shared' || merged.type === 'roommate' || merged.type === 'spare-room') && !merged.location.address) {
      throw new HttpException('Full property address is required for shared apartment and roommate listings.', HttpStatus.BAD_REQUEST);
    }

    const hostVerificationSubmitted = updateInput.verificationDocumentId
      ? await this.attachVerificationDocumentToListing(userId, id, merged.type, updateInput.verificationDocumentId)
      : Boolean(existing.hostVerificationSubmitted);

    merged.hostVerificationSubmitted = hostVerificationSubmitted;
    if (this.isVerificationListingType(merged.type)) {
      merged.listingVerificationStatus = hostVerificationSubmitted ? 'pending' : 'unverified';
    }

    const mergedWithArtifacts = await this.syncPropertyArtifacts(merged, userId);

    await this.databaseService.query(
      'UPDATE app_listings SET data = $2::jsonb, updated_at = NOW() WHERE id = $1',
      [id, JSON.stringify(mergedWithArtifacts)],
    );

    return mergedWithArtifacts;
  }

  async deleteListing(id: string): Promise<void> {
    await this.ensureSchemaReady();
    const docRows = await this.databaseService.query<{ file_path: string }>(
      'SELECT file_path FROM app_listing_verification_documents WHERE listing_id = $1',
      [id],
    );
    await this.databaseService.query('DELETE FROM app_listing_verification_documents WHERE listing_id = $1', [id]);
    await this.databaseService.query('DELETE FROM app_listing_images WHERE listing_id = $1', [id]);
    await Promise.all(docRows.map((row) => unlink(row.file_path).catch(() => undefined)));
    const rows = await this.databaseService.query<{ id: string }>(
      'DELETE FROM app_listings WHERE id = $1 RETURNING id',
      [id],
    );

    if (rows.length === 0) {
      throw new NotFoundException('Listing not found');
    }
  }

  async getProfiles(
    filters: {
      gender?: string;
      minAge?: number;
      maxAge?: number;
      minBudget?: number;
      maxBudget?: number;
      location?: string;
    },
    requestingUserId?: string,
  ): Promise<Array<ProfileRecord & { contactUnlocked: boolean; matchScore?: number; matchReasons?: string[] }>> {
    await this.ensureSchemaReady();

    const rows = await this.databaseService.query<{ data: ProfileRecord; user_id: string | null }>(
      'SELECT data, user_id FROM app_profiles ORDER BY created_at DESC',
    );

    let unlockedSet = new Set<string>();
    if (requestingUserId) {
      const unlockedRows = await this.databaseService.query<{ profile_id: string }>(
        'SELECT profile_id FROM app_unlocked_profiles WHERE user_id = $1',
        [requestingUserId],
      );
      unlockedSet = new Set(unlockedRows.map((r) => r.profile_id));
    }

    const latestHousingRequest = requestingUserId ? await this.getLatestHousingRequest(requestingUserId) : null;

    const profiles = rows.map((row) => ({
      ...row.data,
      contactUnlocked: row.user_id ? unlockedSet.has(row.user_id) : false,
    }));

    const scoredProfiles = latestHousingRequest
      ? profiles
          .filter((profile) => !requestingUserId || profile.id !== requestingUserId)
          .map((profile) => {
            const score = this.scoreProfileAgainstHousingRequest(profile, latestHousingRequest);
            return {
              ...profile,
              matchScore: score.total,
              matchReasons: score.reasons,
            };
          })
          .sort((left, right) => (right.matchScore || 0) - (left.matchScore || 0))
      : profiles;

    return scoredProfiles.filter((profile) => {
      if (filters.gender && filters.gender !== 'any' && profile.gender !== filters.gender) return false;
      if (typeof filters.minAge === 'number' && profile.age < filters.minAge) return false;
      if (typeof filters.maxAge === 'number' && profile.age > filters.maxAge) return false;
      if (typeof filters.minBudget === 'number' && profile.preferences.budget.max < filters.minBudget) return false;
      if (typeof filters.maxBudget === 'number' && profile.preferences.budget.min > filters.maxBudget) return false;
      if (filters.location && !profile.preferences.location.includes(filters.location)) return false;
      return true;
    });
  }

  async getProfileById(
    id: string,
    requestingUserId?: string,
  ): Promise<ProfileRecord & { contactUnlocked: boolean }> {
    await this.ensureSchemaReady();

    // Match on profile id first; fall back to user_id so callers that pass
    // the auth user UUID (old frontend behaviour) still resolve correctly.
    const rows = await this.databaseService.query<{ data: ProfileRecord; user_id: string | null }>(
      'SELECT data, user_id FROM app_profiles WHERE id = $1 OR user_id = $1 LIMIT 1',
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Profile not found');

    let contactUnlocked = false;
    if (requestingUserId && row.user_id) {
      const unlocked = await this.databaseService.query(
        'SELECT 1 FROM app_unlocked_profiles WHERE user_id = $1 AND profile_id = $2 LIMIT 1',
        [requestingUserId, row.user_id],
      );
      contactUnlocked = unlocked.length > 0;
    }

    return { ...row.data, contactUnlocked };
  }

  private async getLatestHousingRequest(userId: string): Promise<HousingRequestRecord | null> {
    const rows = await this.databaseService.query<{ data: HousingRequestRecord }>(
      'SELECT data FROM app_housing_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId],
    );

    return rows[0]?.data || null;
  }

  private clampScore(value: number): number {
    if (Number.isNaN(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  private scoreProfileAgainstHousingRequest(
    profile: ProfileRecord,
    request: HousingRequestRecord,
  ): { total: number; reasons: string[] } {
    const requestBudget = { min: request.budgetMin, max: request.budgetMax };
    const profileBudget = profile.preferences.budget;

    const budgetOverlapMin = Math.max(requestBudget.min, profileBudget.min);
    const budgetOverlapMax = Math.min(requestBudget.max, profileBudget.max);
    const budgetOverlap = Math.max(0, budgetOverlapMax - budgetOverlapMin);
    const budgetSpan = Math.max(1, requestBudget.max - requestBudget.min);
    const budgetScore = budgetOverlap > 0 ? this.clampScore((budgetOverlap / budgetSpan) * 100) : 0;

    const requestLocations = [request.city, request.area].filter(Boolean).map((value) => value.toLowerCase());
    const profileLocations = profile.preferences.location.map((value) => value.toLowerCase());
    const locationHits = requestLocations.filter((location) =>
      profileLocations.some((profileLocation) => profileLocation.includes(location) || location.includes(profileLocation)),
    );
    const locationScore = locationHits.length > 0 ? 100 : 25;

    const requestMoveIn = request.moveInDate ? new Date(request.moveInDate).getTime() : 0;
    const profileMoveIn = profile.preferences.moveInDate ? new Date(profile.preferences.moveInDate).getTime() : 0;
    const moveInDiffDays = requestMoveIn && profileMoveIn
      ? Math.abs(requestMoveIn - profileMoveIn) / (1000 * 60 * 60 * 24)
      : 30;
    const moveInScore = moveInDiffDays <= 7 ? 100 : moveInDiffDays <= 30 ? 80 : moveInDiffDays <= 60 ? 55 : 25;

    const lifestyleMatches: string[] = [];
    const requestLifestyle = request.lifestyle || {};
    if (requestLifestyle.smokingAllowed === profile.preferences.smokingAllowed) lifestyleMatches.push('Smoking preference aligned');
    if (requestLifestyle.petsAllowed === profile.preferences.petsAllowed) lifestyleMatches.push('Pets preference aligned');
    if (requestLifestyle.genderPreference === 'any' || requestLifestyle.genderPreference === profile.gender) {
      lifestyleMatches.push('Gender preference aligned');
    }
    if (typeof requestLifestyle.cleanliness === 'number') {
      const cleanlinessGap = Math.abs(requestLifestyle.cleanliness - profile.preferences.cleanliness);
      if (cleanlinessGap <= 1) lifestyleMatches.push('Similar cleanliness expectations');
    }
    if (typeof requestLifestyle.socialLevel === 'number') {
      const socialGap = Math.abs(requestLifestyle.socialLevel - profile.preferences.socialLevel);
      if (socialGap <= 1) lifestyleMatches.push('Similar social pace');
    }
    const lifestyleScore = this.clampScore((lifestyleMatches.length / 5) * 100);

    const preferredPropertyTypes = new Set((request.propertyTypes || []).map((value) => value.toLowerCase()));
    const requestedPropertyType = String(request.propertyType || '').toLowerCase();
    const profilePropertyTypes = new Set((profile.preferences.propertyTypes || []).map((value) => value.toLowerCase()));
    const propertyTypeMatch =
      (requestedPropertyType && profilePropertyTypes.has(requestedPropertyType)) ||
      (preferredPropertyTypes.size > 0 && Array.from(preferredPropertyTypes).some((value) => profilePropertyTypes.has(value)));
    const propertyScore = propertyTypeMatch ? 100 : 40;

    const roommatePreferenceMatch =
      request.requestType === 'ROOMMATE'
        ? profile.roles?.includes('tenant') || profile.role === 'tenant' || profile.role === 'outgoing-occupant'
        : true;
    const roommateScore = roommatePreferenceMatch ? 100 : 35;

    const otherScore = request.radiusKm && request.radiusKm <= 5 ? 90 : 60;

    const total = this.clampScore(
      budgetScore * 0.25 +
        locationScore * 0.2 +
        moveInScore * 0.1 +
        lifestyleScore * 0.15 +
        propertyScore * 0.1 +
        roommateScore * 0.1 +
        otherScore * 0.1,
    );

    const reasons = [
      budgetScore >= 70 ? 'Within budget' : 'Budget is a partial fit',
      locationHits.length > 0 ? `Matches preferred location: ${locationHits[0]}` : 'Location is nearby',
      moveInScore >= 80 ? 'Compatible move-in timing' : 'Move-in timing is close',
      ...lifestyleMatches.slice(0, 2),
    ].filter(Boolean);

    return { total, reasons };
  }

  async createHousingRequest(input: Record<string, unknown>, userId: string): Promise<HousingRequestRecord> {
    await this.ensureSchemaReady();

    const requestInput = input as Partial<HousingRequestRecord>;
    const request: HousingRequestRecord = {
      id: randomUUID(),
      userId,
      requestType: requestInput.requestType || 'ROOMMATE',
      city: requestInput.city || '',
      state: requestInput.state || '',
      area: requestInput.area || '',
      latitude: requestInput.latitude,
      longitude: requestInput.longitude,
      radiusKm: requestInput.radiusKm,
      budgetMin: Number(requestInput.budgetMin ?? 0),
      budgetMax: Number(requestInput.budgetMax ?? 0),
      bedrooms: requestInput.bedrooms,
      propertyType: requestInput.propertyType,
      furnished: requestInput.furnished,
      moveInDate: requestInput.moveInDate || new Date().toISOString(),
      duration: requestInput.duration,
      propertyTypes: requestInput.propertyTypes || [],
      lifestyle: requestInput.lifestyle,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.databaseService.query(
      `INSERT INTO app_housing_requests (id, user_id, data)
       VALUES ($1, $2, $3::jsonb)`,
      [request.id, userId, JSON.stringify(request)],
    );

    await this.generateMatchesForHousingRequest(request);
    return request;
  }

  private async generateMatchesForHousingRequest(request: HousingRequestRecord): Promise<void> {
    const rows = await this.databaseService.query<{ data: ProfileRecord; user_id: string | null }>(
      'SELECT data, user_id FROM app_profiles ORDER BY created_at DESC',
    );

    for (const row of rows) {
      if (!row.user_id || row.user_id === request.userId) continue;
      const score = this.scoreProfileAgainstHousingRequest(row.data, request);
      const match: MatchRecord = {
        id: randomUUID(),
        sourceUserId: request.userId,
        targetUserId: row.user_id,
        housingRequestId: request.id,
        score: score.total,
        status: 'PENDING',
        reasons: score.reasons,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await this.databaseService.query(
        `INSERT INTO app_matches (id, source_user_id, target_user_id, housing_request_id, score, status, reasons, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
        [match.id, match.sourceUserId, match.targetUserId, match.housingRequestId, match.score, match.status, JSON.stringify(match.reasons), JSON.stringify(match)],
      );
    }
  }

  async getHousingRequests(userId: string): Promise<HousingRequestRecord[]> {
    await this.ensureSchemaReady();
    const rows = await this.databaseService.query<{ data: HousingRequestRecord }>(
      'SELECT data FROM app_housing_requests WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows.map((row) => row.data);
  }

  async getMatches(userId: string): Promise<MatchRecord[]> {
    await this.ensureSchemaReady();
    const rows = await this.databaseService.query<{ data: MatchRecord }>(
      'SELECT data FROM app_matches WHERE source_user_id = $1 ORDER BY score DESC, created_at DESC',
      [userId],
    );
    return rows.map((row) => row.data);
  }

  async createProfile(input: Record<string, unknown>, userId?: string): Promise<ProfileRecord> {
    await this.ensureSchemaReady();

    if (userId) {
      const existing = await this.databaseService.query<{ id: string }>(
        'SELECT id FROM app_profiles WHERE user_id = $1 LIMIT 1',
        [userId],
      );
      if (existing.length > 0) {
        throw new ConflictException('User already has a profile');
      }
    }

    const profileInput = input as Partial<ProfileRecord>;
    const profile: ProfileRecord = {
      // Honour a client-supplied id (legacy frontend sends auth user UUID as id)
      // but always generate a fresh one if none is provided.
      id: (profileInput.id as string | undefined) || randomUUID(),
      name: profileInput.name || 'New User',
      age: Number(profileInput.age ?? 25),
      gender: profileInput.gender || 'other',
      occupation: profileInput.occupation || 'other',
      bio: profileInput.bio || '',
      avatar: profileInput.avatar || '',
      email: profileInput.email,
      phone: profileInput.phone,
      role: profileInput.role || 'tenant',
      roles: profileInput.roles || [profileInput.role || 'tenant'],
      preferences: profileInput.preferences || {
        budget: { min: 0, max: 0 },
        location: [],
        genderPreference: 'any',
        ageRange: { min: 18, max: 65 },
        moveInDate: new Date().toISOString(),
        lifestyle: [],
        cleanliness: 3,
        socialLevel: 3,
        petsAllowed: false,
        smokingAllowed: false,
      },
      verified: Boolean(profileInput.verified),
      isVerified: Boolean(profileInput.isVerified),
    };

    await this.databaseService.query(
      'INSERT INTO app_profiles (id, data, user_id) VALUES ($1, $2::jsonb, $3)',
      [profile.id, JSON.stringify(profile), userId ?? null],
    );

    return profile;
  }

  async updateProfile(
    id: string,
    updates: Record<string, unknown>,
    requestingUserId: string,
    requestingUserRole: string,
  ): Promise<ProfileRecord> {
    await this.ensureSchemaReady();

    const rows = await this.databaseService.query<{ id: string; user_id: string | null }>(
      'SELECT id, user_id FROM app_profiles WHERE id = $1 OR user_id = $1 LIMIT 1',
      [id],
    );

    if (rows.length === 0) throw new NotFoundException('Profile not found');

    const ownerUserId = rows[0].user_id;
    if (requestingUserRole !== 'admin' && ownerUserId !== requestingUserId) {
      throw new ForbiddenException('Not authorized to update this profile');
    }

    const profileId = rows[0].id;
    const existing = await this.getProfileById(profileId, requestingUserId);
    const merged: ProfileRecord = {
      ...existing,
      ...(updates as Partial<ProfileRecord>),
      id: profileId,
    };

    await this.databaseService.query(
      'UPDATE app_profiles SET data = $2::jsonb, updated_at = NOW() WHERE id = $1',
      [profileId, JSON.stringify(merged)],
    );

    return merged;
  }

  async deleteProfile(id: string, requestingUserId: string, requestingUserRole: string): Promise<void> {
    await this.ensureSchemaReady();

    const rows = await this.databaseService.query<{ id: string; user_id: string | null }>(
      'SELECT id, user_id FROM app_profiles WHERE id = $1 OR user_id = $1 LIMIT 1',
      [id],
    );

    if (rows.length === 0) throw new NotFoundException('Profile not found');

    const ownerUserId = rows[0].user_id;
    if (requestingUserRole !== 'admin' && ownerUserId !== requestingUserId) {
      throw new ForbiddenException('Not authorized to delete this profile');
    }

    await this.databaseService.query('DELETE FROM app_profiles WHERE id = $1', [rows[0].id]);
  }

  async getRequests(userId: string): Promise<RequestRecord[]> {
    await this.ensureSchemaReady();
    const rows = await this.databaseService.query<{ data: RequestRecord }>(
      'SELECT data FROM app_requests ORDER BY created_at DESC',
    );
    return rows
      .map((row) => row.data)
      .filter((item) => item.fromUserId === userId || item.toUserId === userId);
  }

  async getReceivedRoommateRequests(userId: string): Promise<Array<{
    id: string;
    from_user_id: string;
    to_user_id: string;
    status: 'pending' | 'accepted' | 'rejected';
    created_at: string;
  }>> {
    const requests = await this.getRequests(userId);
    return requests
      .filter((item) => item.toUserId === userId)
      .map((item) => ({
        id: item.id,
        from_user_id: item.fromUserId,
        to_user_id: item.toUserId,
        status: item.status,
        created_at: item.createdAt,
      }));
  }

  async createRequest(input: {
    fromUserId: string;
    toUserId: string;
    type: 'roommate' | 'office';
    message?: string;
  }): Promise<RequestRecord> {
    await this.ensureSchemaReady();
    const request: RequestRecord = {
      id: randomUUID(),
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      type: input.type,
      status: 'pending',
      message: input.message,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.databaseService.query(
      'INSERT INTO app_requests (id, data) VALUES ($1, $2::jsonb)',
      [request.id, JSON.stringify(request)],
    );

    return request;
  }

  async updateRequestStatus(
    id: string,
    status: 'accepted' | 'rejected',
    requestingUserId: string,
    requestingUserRole: string,
  ): Promise<RequestRecord> {
    const rows = await this.databaseService.query<{ data: RequestRecord }>(
      'SELECT data FROM app_requests WHERE id = $1 LIMIT 1',
      [id],
    );
    const existing = rows[0]?.data;

    if (!existing) throw new NotFoundException('Request not found');
    if (requestingUserRole !== 'admin' && existing.toUserId !== requestingUserId) {
      throw new ForbiddenException('Not authorized to update this request');
    }

    const updated: RequestRecord = {
      ...existing,
      status,
      updatedAt: new Date().toISOString(),
    };

    await this.databaseService.query(
      'UPDATE app_requests SET data = $2::jsonb, updated_at = NOW() WHERE id = $1',
      [id, JSON.stringify(updated)],
    );

    return updated;
  }

  async getSavedListings(userId: string): Promise<string[]> {
    await this.ensureSchemaReady();
    const rows = await this.databaseService.query<{ listing_id: string }>(
      'SELECT listing_id FROM app_saved_listings WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows.map((row) => row.listing_id);
  }

  async saveListing(userId: string, listingId: string): Promise<string[]> {
    await this.ensureSchemaReady();
    await this.databaseService.query(
      'INSERT INTO app_saved_listings (user_id, listing_id) VALUES ($1, $2) ON CONFLICT (user_id, listing_id) DO NOTHING',
      [userId, listingId],
    );
    return this.getSavedListings(userId);
  }

  async unsaveListing(userId: string, listingId: string): Promise<string[]> {
    await this.ensureSchemaReady();
    await this.databaseService.query(
      'DELETE FROM app_saved_listings WHERE user_id = $1 AND listing_id = $2',
      [userId, listingId],
    );
    return this.getSavedListings(userId);
  }

  async deleteUser(userId: string): Promise<void> {
    await this.ensureSchemaReady();
    await this.databaseService.query('DELETE FROM app_profiles WHERE id = $1', [userId]);
    await this.databaseService.query(
      "DELETE FROM app_requests WHERE (data->>'fromUserId' = $1 OR data->>'toUserId' = $1)",
      [userId],
    );
    await this.databaseService.query('DELETE FROM app_saved_listings WHERE user_id = $1', [userId]);
    await this.databaseService.query('DELETE FROM app_auth_users WHERE id = $1', [userId]);
  }

  async getStats(): Promise<{
    properties: number;
    users: number;
    partners: number;
    cities: number;
  }> {
    const listings = await this.getListings({});
    const profiles = await this.getProfiles({});
    const requestRows = await this.databaseService.query<{ data: RequestRecord }>(
      'SELECT data FROM app_requests',
    );
    const requests = requestRows.map((row) => row.data);
    const cities = new Set(listings.map((listing) => listing.location.city).filter(Boolean));

    return {
      properties: listings.length,
      users: profiles.length,
      partners: requests.filter((request) => request.status === 'accepted').length,
      cities: cities.size,
    };
  }

  async getVerificationStatus(userId: string): Promise<{
    emailVerified: boolean;
    phoneVerified: boolean;
    idVerified: boolean;
    email?: string;
    phone?: string;
    otp?: string;
    otpExpiresAt?: string;
    idFileName?: string;
  }> {
    await this.ensureSchemaReady();

    const rows = await this.databaseService.query<{ data: any }>(
      'SELECT data FROM app_verifications WHERE user_id = $1 LIMIT 1',
      [userId],
    );

    return rows[0]?.data || {
      emailVerified: false,
      phoneVerified: false,
      idVerified: false,
    };
  }

  private async saveVerificationStatus(userId: string, data: Record<string, unknown>): Promise<void> {
    await this.databaseService.query(
      `INSERT INTO app_verifications (user_id, data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [userId, JSON.stringify(data)],
    );
  }

  async verifyEmail(userId: string, email: string): Promise<Record<string, unknown>> {
    const current = await this.getVerificationStatus(userId);
    const updated = {
      ...current,
      email,
      emailVerified: true,
    };
    await this.saveVerificationStatus(userId, updated);
    return updated;
  }

  async verifyPhone(userId: string, phone: string): Promise<Record<string, unknown>> {
    const current = await this.getVerificationStatus(userId);
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const updated = {
      ...current,
      phone,
      otp,
      otpExpiresAt,
      phoneVerified: false,
    };
    await this.saveVerificationStatus(userId, updated);
    return {
      ...updated,
      message: 'OTP generated for development mode.',
    };
  }

  async confirmPhoneOtp(userId: string, phone: string, code: string): Promise<Record<string, unknown>> {
    const current = await this.getVerificationStatus(userId);
    const otp = String(current.otp || '');
    const otpExpiresAt = current.otpExpiresAt ? Date.parse(String(current.otpExpiresAt)) : 0;
    const phoneMatches = String(current.phone || '') === phone;

    if (!phoneMatches || otp !== code || !otpExpiresAt || otpExpiresAt < Date.now()) {
      throw new NotFoundException('Invalid or expired code');
    }

    const updated = {
      ...current,
      phone,
      phoneVerified: true,
      otp: null,
      otpExpiresAt: null,
    };
    await this.saveVerificationStatus(userId, updated);
    return updated;
  }

  async verifyId(userId: string, fileName: string): Promise<Record<string, unknown>> {
    const current = await this.getVerificationStatus(userId);
    const updated = {
      ...current,
      idVerified: true,
      idFileName: fileName,
    };
    await this.saveVerificationStatus(userId, updated);
    return updated;
  }

  async getReviews(targetType: string, targetId: string): Promise<Array<Record<string, unknown>>> {
    await this.ensureSchemaReady();
    const rows = await this.databaseService.query<{ data: Record<string, unknown> }>(
      'SELECT data FROM app_reviews ORDER BY created_at DESC',
    );
    return rows
      .map((row) => row.data)
      .filter((review) => review.targetType === targetType && review.targetId === targetId);
  }

  async createReview(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensureSchemaReady();
    const review = {
      id: randomUUID(),
      helpful: 0,
      verified: Boolean(payload.verified),
      createdAt: new Date().toISOString(),
      ...payload,
    };

    await this.databaseService.query(
      'INSERT INTO app_reviews (id, data) VALUES ($1, $2::jsonb)',
      [String(review.id), JSON.stringify(review)],
    );

    return review;
  }

  async markReviewHelpful(reviewId: string, targetType: string, targetId: string): Promise<Record<string, unknown>> {
    await this.ensureSchemaReady();
    const rows = await this.databaseService.query<{ data: Record<string, unknown> }>(
      'SELECT data FROM app_reviews WHERE id = $1 LIMIT 1',
      [reviewId],
    );
    const existing = rows[0]?.data;
    if (!existing || existing.targetType !== targetType || existing.targetId !== targetId) {
      throw new NotFoundException('Review not found');
    }

    const nextHelpful = Number(existing.helpful || 0) + 1;
    const updated = { ...existing, helpful: nextHelpful };

    await this.databaseService.query(
      'UPDATE app_reviews SET data = $2::jsonb, updated_at = NOW() WHERE id = $1',
      [reviewId, JSON.stringify(updated)],
    );

    return updated;
  }

  async reportListing(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensureSchemaReady();
    const report = {
      id: randomUUID(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...payload,
    };

    await this.databaseService.query(
      'INSERT INTO app_reports (id, data) VALUES ($1, $2::jsonb)',
      [String(report.id), JSON.stringify(report)],
    );

    return report;
  }

  async getReports(listingId: string): Promise<Array<Record<string, unknown>>> {
    await this.ensureSchemaReady();
    const rows = await this.databaseService.query<{ data: Record<string, unknown> }>(
      'SELECT data FROM app_reports ORDER BY created_at DESC',
    );
    return rows
      .map((row) => row.data)
      .filter((report) => report.listingId === listingId);
  }

  async enqueueNotification(type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ensureSchemaReady();

    const event = {
      id: randomUUID(),
      type,
      payload,
      createdAt: new Date().toISOString(),
      delivered: true,
    };

    await this.databaseService.query(
      'INSERT INTO app_notifications (id, type, payload) VALUES ($1, $2, $3::jsonb)',
      [event.id, type, JSON.stringify(event)],
    );

    return event;
  }

  // ── Wallet ────────────────────────────────────────────────────────────────

  private async ensureWalletRow(userId: string): Promise<void> {
    await this.databaseService.query(
      'INSERT INTO app_wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING',
      [userId],
    );
  }

  private async recordWalletTransaction(
    userId: string,
    transaction: {
      type: 'credit' | 'debit';
      points: number;
      description: string;
      action:
        | 'view-contact'
        | 'book-inspection'
        | 'send-connection'
        | 'unlock-address'
        | 'download-agreement'
        | 'top-up'
        | 'referral-bonus'
        | 'profile-complete-bonus'
        | 'first-topup-bonus'
        | 'review-bonus';
      nairaAmount?: number;
    },
  ): Promise<void> {
    await this.databaseService.query(
      'INSERT INTO app_wallet_transactions (id, user_id, data) VALUES ($1, $2, $3::jsonb)',
      [randomUUID(), userId, JSON.stringify(transaction)],
    );
  }

  private async readWalletBalance(userId: string): Promise<number> {
    const rows = await this.databaseService.query<{ balance: number }>(
      'SELECT balance FROM app_wallets WHERE user_id = $1',
      [userId],
    );
    return rows[0]?.balance ?? 0;
  }

  private calculateTopUp(nairaAmount: number): { points: number; bonusPoints: number } {
    if (!Number.isInteger(nairaAmount) || nairaAmount < 1000) {
      throw new HttpException('Minimum top-up amount is ₦1,000.', HttpStatus.BAD_REQUEST);
    }

    const points = Math.floor(nairaAmount / PlatformService.NAIRA_PER_POINT);
    if (points < 1) {
      throw new HttpException('Top-up amount is too small to credit points.', HttpStatus.BAD_REQUEST);
    }

    const bonusPoints = PlatformService.TOP_UP_BONUS_POINTS[nairaAmount] ?? 0;
    return { points, bonusPoints };
  }

  async getWallet(userId: string): Promise<{ balance: number }> {
    await this.ensureSchemaReady();
    await this.ensureWalletRow(userId);
    return { balance: await this.readWalletBalance(userId) };
  }

  async getWalletTransactions(userId: string): Promise<Array<Record<string, unknown>>> {
    await this.ensureSchemaReady();
    const rows = await this.databaseService.query<{ id: string; data: Record<string, unknown>; created_at: string }>(
      'SELECT id, data, created_at::text FROM app_wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200',
      [userId],
    );

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      ...row.data,
    }));
  }

  async topUpWallet(
    userId: string,
    nairaAmount: number,
    reference?: string,
  ): Promise<{ balance: number; points: number; bonusPoints: number; creditedPoints: number }> {
    await this.ensureSchemaReady();
    await this.ensureWalletRow(userId);

    const { points, bonusPoints } = this.calculateTopUp(nairaAmount);
    const creditedPoints = points + bonusPoints;

    await this.databaseService.query(
      'UPDATE app_wallets SET balance = balance + $2 WHERE user_id = $1',
      [userId, creditedPoints],
    );

    await this.recordWalletTransaction(userId, {
      type: 'credit',
      points,
      nairaAmount,
      description: `Wallet top-up — ₦${nairaAmount.toLocaleString()}${reference ? ` (${reference})` : ''}`,
      action: 'top-up',
    });

    if (bonusPoints > 0) {
      await this.recordWalletTransaction(userId, {
        type: 'credit',
        points: bonusPoints,
        nairaAmount,
        description: `Bonus points for ₦${nairaAmount.toLocaleString()} top-up`,
        action: 'first-topup-bonus',
      });
    }

    return {
      balance: await this.readWalletBalance(userId),
      points,
      bonusPoints,
      creditedPoints,
    };
  }

  async spendWallet(
    userId: string,
    action: string,
    targetId: string,
  ): Promise<{ balance: number }> {
    await this.ensureSchemaReady();

    if (action !== 'send-connection' && action !== 'view-contact') {
      throw new HttpException(`Unknown wallet action: ${action}`, HttpStatus.BAD_REQUEST);
    }

    const cost = action === 'view-contact' ? 5 : 28;

    const profileRows = await this.databaseService.query<{ user_id: string | null }>(
      'SELECT user_id FROM app_profiles WHERE id = $1 LIMIT 1',
      [targetId],
    );
    const listingRows = action === 'view-contact'
      ? await this.databaseService.query<{ id: string }>(
          'SELECT id FROM app_listings WHERE id = $1 LIMIT 1',
          [targetId],
        )
      : [];
    if (profileRows.length === 0 && listingRows.length === 0) {
      throw new NotFoundException('Profile not found');
    }
    const profileUserId = profileRows[0]?.user_id;

    // Ensure wallet row exists
    await this.ensureWalletRow(userId);
    const balance = await this.readWalletBalance(userId);

    if (balance < cost) {
      throw new HttpException('Insufficient wallet balance', HttpStatus.PAYMENT_REQUIRED);
    }

    await this.databaseService.query(
      'UPDATE app_wallets SET balance = balance - $2 WHERE user_id = $1',
      [userId, cost],
    );

    await this.recordWalletTransaction(userId, {
      type: 'debit',
      points: cost,
      description: action === 'view-contact' ? 'Unlocked listing contact' : 'Unlocked profile contact',
      action: action as 'view-contact' | 'send-connection',
    });

    // Store unlock keyed by the profile owner's auth user ID so it survives
    // profile recreation (per spec: store profile.user_id, not profile.id)
    if (profileUserId) {
      await this.databaseService.query(
        'INSERT INTO app_unlocked_profiles (user_id, profile_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, profileUserId],
      );
    }

    return { balance: await this.readWalletBalance(userId) };
  }
}
