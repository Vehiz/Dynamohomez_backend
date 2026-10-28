import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { appEnv } from '../config/env';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ALLOWED_REGISTER_ROLES, RegisterDto } from './dto/register.dto';
import { AuthResponse, AuthTokens, AuthUser } from './auth.types';
import { DatabaseService } from '../config/database';
import { RedisService } from '../config/redis';

// A pre-computed bcrypt hash with no matching password, used to keep the
// login timing profile the same whether or not the account exists.
const DUMMY_PASSWORD_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Q0rHNJqQIRp3v0O.6cXMlG0kQ5T9K';

@Injectable()
export class AuthService {
  private schemaInitPromise: Promise<void> | null = null;

  constructor(
    @Inject(DatabaseService)
    private readonly databaseService: DatabaseService,
    @Inject(RedisService)
    private readonly redisService: RedisService,
  ) {}

  private parseDurationToSeconds(value: string): number {
    const input = String(value || '').trim().toLowerCase();
    const match = input.match(/^(\d+)([smhd])$/);
    if (!match) return 900;

    const amount = Number(match[1]);
    const unit = match[2];

    if (!Number.isFinite(amount) || amount <= 0) return 900;
    if (unit === 's') return amount;
    if (unit === 'm') return amount * 60;
    if (unit === 'h') return amount * 3600;
    return amount * 86400;
  }

  private normalizeRole(input: string): string {
    const value = String(input || '').trim().toLowerCase();
    if (!value) return '';

    // Frontend/onboarding aliases that are conceptually equivalent in auth RBAC.
    if (value === 'home-seeker') return 'tenant';
    if (value === 'roommate-seeker') return 'tenant';
    if (value === 'office-seeker') return 'tenant';
    if (value === 'flatmate-seeker') return 'tenant';
    if (value === 'outgoing-occupant') return 'tenant';
    if (value === 'owner') return 'property-owner';

    return value;
  }

  private dedupeRoles(roles: string[]): string[] {
    return Array.from(new Set(roles.map((role) => this.normalizeRole(role)).filter(Boolean)));
  }

  private async ensureSchemaReady(): Promise<void> {
    if (!this.schemaInitPromise) {
      this.schemaInitPromise = this.initializeSchema();
    }
    await this.schemaInitPromise;
  }

  private async initializeSchema(): Promise<void> {
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_auth_users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        roles JSONB NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Ensure the profiles table and user_id column exist so register/login
    // can immediately insert a stub profile without waiting for a platform request.
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_profiles (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.databaseService.query(`
      ALTER TABLE app_profiles ADD COLUMN IF NOT EXISTS user_id TEXT
    `);

    await this.databaseService.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS app_profiles_user_id_unique
        ON app_profiles (user_id)
        WHERE user_id IS NOT NULL
    `);
  }

  // Creates a minimal profile stub the first time a user registers or logs in.
  // Uses id = user.id so the old frontend pattern (profile id === auth user id) keeps working.
  private async ensureProfileStub(user: AuthUser, phone?: string): Promise<void> {
    const stub = {
      id: user.id,
      name: user.name,
      age: 25,
      gender: 'other',
      occupation: 'other',
      bio: '',
      avatar: '',
      email: user.email,
      phone,
      role: user.role || 'tenant',
      roles: user.roles?.length ? user.roles : [user.role || 'tenant'],
      preferences: {
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
      verified: false,
      isVerified: false,
    };

    await this.databaseService.query(
      `INSERT INTO app_profiles (id, data, user_id)
       VALUES ($1, $2::jsonb, $1)
       ON CONFLICT DO NOTHING`,
      [user.id, JSON.stringify(stub)],
    );
  }

  private async findUserByEmail(email: string): Promise<{
    user: AuthUser;
    passwordHash: string;
  } | null> {
    await this.ensureSchemaReady();

    const normalized = email.toLowerCase().trim();
    const rows = await this.databaseService.query<{
      id: string;
      email: string;
      name: string;
      role: string;
      roles: unknown;
      password_hash: string;
    }>(
      'SELECT id, email, name, role, roles, password_hash FROM app_auth_users WHERE email = $1 LIMIT 1',
      [normalized],
    );

    const row = rows[0];
    if (!row) return null;

    const parsedRoles = Array.isArray(row.roles)
      ? row.roles.map((role) => String(role))
      : [row.role];

    return {
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        roles: parsedRoles,
      },
      passwordHash: row.password_hash,
    };
  }

  async register(payload: RegisterDto): Promise<AuthResponse> {
    const existing = await this.findUserByEmail(payload.email);
    if (existing) {
      throw new UnauthorizedException('An account with this email already exists.');
    }

    const user: AuthUser = {
      id: randomUUID(),
      email: payload.email.toLowerCase().trim(),
      name: payload.name.trim(),
      role: payload.role || 'tenant',
      roles: [payload.role || 'tenant'],
    };

    const passwordHash = await bcrypt.hash(payload.password, 10);
    await this.ensureSchemaReady();
    await this.databaseService.query(
      `INSERT INTO app_auth_users (id, email, name, role, roles, password_hash)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        user.id,
        user.email,
        user.name,
        user.role,
        JSON.stringify(user.roles),
        passwordHash,
      ],
    );

    const tokens = await this.issueTokens(user);
    await this.ensureProfileStub(user, payload.phone.trim());

    return { user, tokens };
  }

  async login(payload: LoginDto): Promise<AuthResponse> {
    const userRecord = await this.findUserByEmail(payload.email);
    if (!userRecord) {
      // Run a bcrypt compare against a dummy hash even when the account doesn't
      // exist, so response time doesn't leak whether the email is registered.
      await bcrypt.compare(payload.password, DUMMY_PASSWORD_HASH);
      throw new UnauthorizedException('Invalid email or password.');
    }

    const isMatch = await bcrypt.compare(payload.password, userRecord.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const tokens = await this.issueTokens(userRecord.user);
    await this.ensureProfileStub(userRecord.user);

    return { user: userRecord.user, tokens };
  }

  private userSessionsKey(userId: string): string {
    return `auth:refresh:user:${userId}`;
  }

  // Revokes every outstanding refresh token for a user, e.g. after a password
  // reset or account deletion, so a previously leaked/stolen token stops working.
  private async revokeAllSessions(userId: string): Promise<void> {
    const sessionsKey = this.userSessionsKey(userId);
    const tokens = await this.redisService.smembers(sessionsKey);
    for (const token of tokens) {
      await this.redisService.del(`auth:refresh:${token}`);
    }
    await this.redisService.del(sessionsKey);
  }

  async refresh(payload: RefreshTokenDto): Promise<AuthTokens> {
    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(payload.refreshToken, appEnv.JWT_REFRESH_SECRET) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (decoded.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const userIdFromToken = String(decoded.sub || '');
    const userIdFromStore = await this.redisService.get(`auth:refresh:${payload.refreshToken}`);

    if (!userIdFromStore || userIdFromStore !== userIdFromToken) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const rows = await this.databaseService.query<{
      id: string;
      email: string;
      name: string;
      role: string;
      roles: unknown;
    }>(
      'SELECT id, email, name, role, roles FROM app_auth_users WHERE id = $1 LIMIT 1',
      [userIdFromStore],
    );

    const userRow = rows[0];
    if (!userRow) {
      await this.redisService.del(`auth:refresh:${payload.refreshToken}`);
      throw new UnauthorizedException('Session is no longer valid.');
    }

    const user: AuthUser = {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      role: userRow.role,
      roles: Array.isArray(userRow.roles) ? userRow.roles.map((role) => String(role)) : [userRow.role],
    };

    await this.redisService.del(`auth:refresh:${payload.refreshToken}`);
    await this.redisService.srem(this.userSessionsKey(user.id), payload.refreshToken);
    const tokens = await this.issueTokens(user);

    return tokens;
  }

  async logout(payload: RefreshTokenDto): Promise<{ success: true }> {
    const userId = await this.redisService.get(`auth:refresh:${payload.refreshToken}`);
    await this.redisService.del(`auth:refresh:${payload.refreshToken}`);
    if (userId) {
      await this.redisService.srem(this.userSessionsKey(userId), payload.refreshToken);
    }
    return { success: true };
  }

  async requestPasswordReset(email: string): Promise<{ resetToken?: string }> {
    const userRecord = await this.findUserByEmail(email);

    if (!userRecord) {
      return {};
    }

    const resetToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    await this.redisService.set(`auth:reset:${resetToken}`, userRecord.user.id, 15 * 60);

    return { resetToken };
  }

  async resetPassword(resetToken: string, password: string): Promise<{ success: true }> {
    const userId = await this.redisService.get(`auth:reset:${resetToken}`);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired reset token.');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await this.databaseService.query(
      'UPDATE app_auth_users SET password_hash = $2, updated_at = NOW() WHERE id = $1',
      [userId, passwordHash],
    );

    await this.redisService.del(`auth:reset:${resetToken}`);
    // A leaked/stolen refresh token must not keep working after the account owner
    // resets their password, so kill every outstanding session.
    await this.revokeAllSessions(userId);

    return { success: true };
  }

  async deleteAccount(userId: string): Promise<{ success: true }> {
    await this.ensureSchemaReady();

    // Remove all user data across every table.
    // Profiles can be linked by profile.id = userId (legacy) or profile.user_id = userId (new).
    await this.databaseService.query(
      'DELETE FROM app_profiles WHERE id = $1 OR user_id = $1',
      [userId],
    );
    await this.databaseService.query(
      "DELETE FROM app_requests WHERE data->>'fromUserId' = $1 OR data->>'toUserId' = $1",
      [userId],
    );
    await this.databaseService.query(
      'DELETE FROM app_saved_listings WHERE user_id = $1',
      [userId],
    );
    await this.databaseService.query(
      'DELETE FROM app_wallets WHERE user_id = $1',
      [userId],
    );
    await this.databaseService.query(
      'DELETE FROM app_wallet_transactions WHERE user_id = $1',
      [userId],
    );
    const verificationDocumentRows = await this.databaseService.query<{ file_path: string }>(
      'SELECT file_path FROM app_listing_verification_documents WHERE user_id = $1',
      [userId],
    );
    await this.databaseService.query(
      'DELETE FROM app_listing_verification_documents WHERE user_id = $1',
      [userId],
    );
    await Promise.all(verificationDocumentRows.map((row) => unlink(row.file_path).catch(() => undefined)));
    await this.databaseService.query(
      'DELETE FROM app_unlocked_profiles WHERE user_id = $1 OR profile_id = $1',
      [userId],
    );
    await this.databaseService.query(
      'DELETE FROM app_verifications WHERE user_id = $1',
      [userId],
    );
    // Delete the auth record last so any mid-deletion failure still leaves
    // the account accessible for a retry.
    await this.databaseService.query(
      'DELETE FROM app_auth_users WHERE id = $1',
      [userId],
    );

    await this.revokeAllSessions(userId);

    return { success: true };
  }

  async updateAccountRoles(
    userId: string,
    requestedRoles: string[],
    requestedPrimaryRole?: string,
  ): Promise<AuthResponse> {
    await this.ensureSchemaReady();

    const normalizedRoles = this.dedupeRoles(Array.isArray(requestedRoles) ? requestedRoles : []);
    if (normalizedRoles.length === 0) {
      throw new BadRequestException('At least one role is required.');
    }

    const allowedRoles = new Set<string>(ALLOWED_REGISTER_ROLES.map((role) => String(role)));
    const invalidRoles = normalizedRoles.filter((role) => !allowedRoles.has(role));
    if (invalidRoles.length > 0) {
      throw new BadRequestException(
        `Unsupported role(s): ${invalidRoles.join(', ')}. Allowed roles: ${Array.from(allowedRoles).join(', ')}`,
      );
    }

    const preferredPrimary = requestedPrimaryRole ? this.normalizeRole(requestedPrimaryRole) : normalizedRoles[0];
    const primaryRole = normalizedRoles.includes(preferredPrimary) ? preferredPrimary : normalizedRoles[0];

    const rows = await this.databaseService.query<{
      id: string;
      email: string;
      name: string;
    }>('SELECT id, email, name FROM app_auth_users WHERE id = $1 LIMIT 1', [userId]);

    const userRow = rows[0];
    if (!userRow) {
      throw new UnauthorizedException('Account not found.');
    }

    await this.databaseService.query(
      'UPDATE app_auth_users SET role = $2, roles = $3::jsonb, updated_at = NOW() WHERE id = $1',
      [userId, primaryRole, JSON.stringify(normalizedRoles)],
    );

    // Keep profile role/roles aligned for frontend role displays.
    const profileRows = await this.databaseService.query<{ id: string; data: Record<string, unknown> }>(
      'SELECT id, data FROM app_profiles WHERE user_id = $1 OR id = $1',
      [userId],
    );

    for (const row of profileRows) {
      const nextProfile = {
        ...(row.data || {}),
        role: primaryRole,
        roles: normalizedRoles,
      };

      await this.databaseService.query(
        'UPDATE app_profiles SET data = $2::jsonb, updated_at = NOW() WHERE id = $1',
        [row.id, JSON.stringify(nextProfile)],
      );
    }

    const user: AuthUser = {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      role: primaryRole,
      roles: normalizedRoles,
    };

    const tokens = await this.issueTokens(user);
    return { user, tokens };
  }

  async getGoogleOAuthStartUrl(redirectTo?: string): Promise<{ url: string }> {
    const target = redirectTo || appEnv.GOOGLE_CALLBACK_URL || '';
    if (!target) {
      throw new UnauthorizedException('Google OAuth callback is not configured.');
    }

    throw new UnauthorizedException('Google OAuth is not implemented yet in this migration phase.');
  }

  private async issueTokens(user: AuthUser): Promise<AuthTokens> {
    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        roles: user.roles,
      },
      appEnv.JWT_ACCESS_SECRET,
      { expiresIn: appEnv.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );

    const refreshToken = jwt.sign(
      {
        sub: user.id,
        type: 'refresh',
      },
      appEnv.JWT_REFRESH_SECRET,
      { expiresIn: appEnv.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );

    const refreshTokenTtl = this.parseDurationToSeconds(appEnv.JWT_REFRESH_EXPIRES_IN);
    await this.redisService.set(`auth:refresh:${refreshToken}`, user.id, refreshTokenTtl);
    const sessionsKey = this.userSessionsKey(user.id);
    await this.redisService.sadd(sessionsKey, refreshToken);
    await this.redisService.expire(sessionsKey, refreshTokenTtl);

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: appEnv.JWT_ACCESS_EXPIRES_IN,
      refreshTokenExpiresIn: appEnv.JWT_REFRESH_EXPIRES_IN,
    };
  }
}
