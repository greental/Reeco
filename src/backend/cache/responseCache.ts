import { createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { loadConfig } from '../config/env.js';

type JsonValue = unknown;

interface CacheEnvelope<T> {
  value: T;
}

const config = loadConfig();
const valuePrefix = `${config.cache.namespace}:value`;
const lruKey = `${config.cache.namespace}:lru`;
const versionKey = `${config.cache.namespace}:version`;

let clientPromise: Promise<RedisClientType | null> | null = null;
let namespaceVersion = 0;

function isEnabled(): boolean {
  return config.redis.enabled && config.cache.maxEntries > 0 && config.cache.ttlSeconds > 0;
}

async function getClient(): Promise<RedisClientType | null> {
  if (!isEnabled()) {
    return null;
  }

  if (!clientPromise) {
    clientPromise = (async () => {
      const client = createClient({ url: config.redis.url }) as RedisClientType;
      client.on('error', (error) => {
        console.warn('Redis cache error; continuing without cache:', error.message);
      });

      try {
        await client.connect();
        return client;
      } catch (error) {
        console.warn('Redis cache unavailable; continuing without cache:', error instanceof Error ? error.message : error);
        return null;
      }
    })();
  }

  return clientPromise;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function makeCacheKey(namespace: string, parts: Record<string, unknown> = {}): string {
  const hash = createHash('sha256').update(stableStringify(parts)).digest('hex').slice(0, 24);
  return `${namespace}:${hash}`;
}

async function getNamespaceVersion(client: RedisClientType): Promise<number> {
  const value = await client.get(versionKey);
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) {
    namespaceVersion = parsed;
    return parsed;
  }
  return namespaceVersion;
}

function valueKey(version: number, key: string): string {
  return `${valuePrefix}:v${version}:${key}`;
}

async function touchAndEvict(client: RedisClientType, key: string): Promise<void> {
  const now = Date.now();
  await client.zAdd(lruKey, [{ score: now, value: key }]);
  const size = await client.zCard(lruKey);
  const overflow = size - config.cache.maxEntries;
  if (overflow <= 0) {
    return;
  }

  const staleKeys = await client.zRange(lruKey, 0, overflow - 1);
  if (staleKeys.length === 0) {
    return;
  }

  await client.del(staleKeys);
  await client.zRem(lruKey, staleKeys);
}

export async function getCached<T>(key: string): Promise<T | null> {
  const client = await getClient();
  if (!client) {
    return null;
  }

  try {
    const version = await getNamespaceVersion(client);
    const keyWithVersion = valueKey(version, key);
    const raw = await client.get(keyWithVersion);
    if (!raw) {
      return null;
    }

    await touchAndEvict(client, keyWithVersion);
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    return envelope.value;
  } catch (error) {
    console.warn('Redis cache read failed; continuing without cache:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function setCached<T extends JsonValue>(key: string, value: T): Promise<void> {
  const client = await getClient();
  if (!client) {
    return;
  }

  try {
    const version = await getNamespaceVersion(client);
    const keyWithVersion = valueKey(version, key);
    await client.set(keyWithVersion, JSON.stringify({ value }), { EX: config.cache.ttlSeconds });
    await touchAndEvict(client, keyWithVersion);
  } catch (error) {
    console.warn('Redis cache write failed; continuing without cache:', error instanceof Error ? error.message : error);
  }
}

export async function cached<T extends JsonValue>(key: string, loader: () => Promise<T>): Promise<T> {
  const cachedValue = await getCached<T>(key);
  if (cachedValue !== null) {
    return cachedValue;
  }

  const value = await loader();
  await setCached(key, value);
  return value;
}

export async function invalidateApiCache(): Promise<void> {
  const client = await getClient();
  if (!client) {
    return;
  }

  try {
    namespaceVersion = await client.incr(versionKey);
    await client.del(lruKey);
  } catch (error) {
    console.warn('Redis cache invalidation failed:', error instanceof Error ? error.message : error);
  }
}