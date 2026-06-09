export interface AppConfig {
  port: number;
  nodeEnv: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 3000);

  return {
    port: Number.isFinite(port) ? port : 3000,
    nodeEnv: env.NODE_ENV ?? 'development',
  };
}
