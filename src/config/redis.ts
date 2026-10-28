import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient } from 'redis';
import { appEnv } from './env';

type MemoryValueEntry = {
  value: string;
  expiresAt?: number;
};

type MemorySetEntry = {
  members: Set<string>;
  expiresAt?: number;
};

type RedisClient = ReturnType<typeof createClient>;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: RedisClient | null = null;
  private clientPromise: Promise<RedisClient | null> | null = null;
  private redisUnavailable = false;
  private readonly memoryValues = new Map<string, MemoryValueEntry>();
  private readonly memorySets = new Map<string, MemorySetEntry>();

  private markRedisUnavailable(client?: RedisClient | null): void {
    this.redisUnavailable = true;
    if (client && this.client === client) {
      this.client = null;
    }
    if (!client) {
      this.client = null;
    }
  }

  private async getClient(): Promise<RedisClient | null> {
    if (this.redisUnavailable) {
      return null;
    }

    if (this.client) {
      return this.client;
    }

    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const client = createClient({ url: appEnv.REDIS_URL, socket: { family: 4 } });
        client.on('error', (error) => {
          console.error('Redis client error', error);
          this.markRedisUnavailable(client);
        });

        try {
          await client.connect();
          this.client = client;
          return client;
        } catch (error) {
          console.error('Redis client error', error);
          this.markRedisUnavailable(client);
          try {
            await client.quit();
          } catch {
            // Ignore cleanup failures when the Redis server is unavailable.
          }
          return null;
        } finally {
          this.clientPromise = null;
        }
      })();
    }

    return this.clientPromise;
  }

  private isExpired(expiresAt?: number): boolean {
    return typeof expiresAt === 'number' && expiresAt <= Date.now();
  }

  private memoryGet(key: string): string | null {
    const entry = this.memoryValues.get(key);
    if (!entry) {
      return null;
    }

    if (this.isExpired(entry.expiresAt)) {
      this.memoryValues.delete(key);
      return null;
    }

    return entry.value;
  }

  private memorySet(key: string, value: string, ttlSeconds?: number): void {
    const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined;
    this.memoryValues.set(key, { value, expiresAt });
    this.memorySets.delete(key);
  }

  private memoryDel(key: string): void {
    this.memoryValues.delete(key);
    this.memorySets.delete(key);
  }

  private memorySAdd(key: string, member: string): void {
    const existing = this.memorySets.get(key);
    const members = existing && !this.isExpired(existing.expiresAt) ? existing.members : new Set<string>();
    members.add(member);
    this.memorySets.set(key, { members, expiresAt: existing?.expiresAt });
    this.memoryValues.delete(key);
  }

  private memorySRem(key: string, member: string): void {
    const existing = this.memorySets.get(key);
    if (!existing || this.isExpired(existing.expiresAt)) {
      this.memorySets.delete(key);
      return;
    }

    existing.members.delete(member);
    if (existing.members.size === 0) {
      this.memorySets.delete(key);
      return;
    }

    this.memorySets.set(key, existing);
  }

  private memorySMembers(key: string): string[] {
    const existing = this.memorySets.get(key);
    if (!existing) {
      return [];
    }

    if (this.isExpired(existing.expiresAt)) {
      this.memorySets.delete(key);
      return [];
    }

    return [...existing.members];
  }

  private memoryExpire(key: string, ttlSeconds: number): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;

    const valueEntry = this.memoryValues.get(key);
    if (valueEntry) {
      this.memoryValues.set(key, { ...valueEntry, expiresAt });
      return;
    }

    const setEntry = this.memorySets.get(key);
    if (setEntry) {
      this.memorySets.set(key, { ...setEntry, expiresAt });
    }
  }

  async ping(): Promise<boolean> {
    const client = await this.getClient();
    if (!client) {
      return false;
    }

    try {
      await client.ping();
      return true;
    } catch (error) {
      console.error('Redis client error', error);
      this.markRedisUnavailable(client);
      return false;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      this.memorySet(key, value, ttlSeconds);
      return;
    }

    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await client.set(key, value, { EX: ttlSeconds });
        return;
      }

      await client.set(key, value);
    } catch (error) {
      console.error('Redis client error', error);
      this.markRedisUnavailable(client);
      this.memorySet(key, value, ttlSeconds);
    }
  }

  async get(key: string): Promise<string | null> {
    const client = await this.getClient();
    if (!client) {
      return this.memoryGet(key);
    }

    try {
      return await client.get(key);
    } catch (error) {
      console.error('Redis client error', error);
      this.markRedisUnavailable(client);
      return this.memoryGet(key);
    }
  }

  async del(key: string): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      this.memoryDel(key);
      return;
    }

    try {
      await client.del(key);
    } catch (error) {
      console.error('Redis client error', error);
      this.markRedisUnavailable(client);
      this.memoryDel(key);
    }
  }

  async sadd(key: string, member: string): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      this.memorySAdd(key, member);
      return;
    }

    try {
      await client.sAdd(key, member);
    } catch (error) {
      console.error('Redis client error', error);
      this.markRedisUnavailable(client);
      this.memorySAdd(key, member);
    }
  }

  async srem(key: string, member: string): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      this.memorySRem(key, member);
      return;
    }

    try {
      await client.sRem(key, member);
    } catch (error) {
      console.error('Redis client error', error);
      this.markRedisUnavailable(client);
      this.memorySRem(key, member);
    }
  }

  async smembers(key: string): Promise<string[]> {
    const client = await this.getClient();
    if (!client) {
      return this.memorySMembers(key);
    }

    try {
      return await client.sMembers(key);
    } catch (error) {
      console.error('Redis client error', error);
      this.markRedisUnavailable(client);
      return this.memorySMembers(key);
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const client = await this.getClient();
    if (!client) {
      this.memoryExpire(key, ttlSeconds);
      return;
    }

    try {
      await client.expire(key, ttlSeconds);
    } catch (error) {
      console.error('Redis client error', error);
      this.markRedisUnavailable(client);
      this.memoryExpire(key, ttlSeconds);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}
