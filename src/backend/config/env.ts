export interface DatabaseConfig {
  url: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface RedisConfig {
  url: string;
  enabled: boolean;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  database: DatabaseConfig;
  redis: RedisConfig;
}

const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE = {
  host: 'localhost',
  port: 5432,
  database: 'order_ops',
  user: 'postgres',
  password: 'postgres',
};
const DEFAULT_DATABASE_URL = `postgresql://${DEFAULT_DATABASE.user}:${DEFAULT_DATABASE.password}@${DEFAULT_DATABASE.host}:${DEFAULT_DATABASE.port}/${DEFAULT_DATABASE.database}`;
const DEFAULT_REDIS_URL = 'redis://localhost:6379';

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const database: DatabaseConfig = {
    url: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    host: env.POSTGRES_HOST ?? DEFAULT_DATABASE.host,
    port: parseInteger(env.POSTGRES_PORT, DEFAULT_DATABASE.port),
    database: env.POSTGRES_DB ?? DEFAULT_DATABASE.database,
    user: env.POSTGRES_USER ?? DEFAULT_DATABASE.user,
    password: env.POSTGRES_PASSWORD ?? DEFAULT_DATABASE.password,
  };

  return {
    port: parseInteger(env.PORT, DEFAULT_PORT),
    nodeEnv: env.NODE_ENV ?? 'development',
    database,
    redis: {
      url: env.REDIS_URL ?? DEFAULT_REDIS_URL,
      enabled: parseBoolean(env.REDIS_ENABLED, false),
    },
  };
}
