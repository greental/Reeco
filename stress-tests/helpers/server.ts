import { spawn, type ChildProcess } from 'node:child_process';

export interface StartedServer {
  baseUrl: string;
  stop: () => Promise<void>;
}

export async function startServer(env: NodeJS.ProcessEnv): Promise<StartedServer> {
  const port = Number(env.PORT);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['dist/backend/server.js'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: string[] = [];
  child.stdout?.on('data', (chunk) => logs.push(String(chunk).trim()));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk).trim()));

  await waitForHealth(baseUrl, child, logs);

  return {
    baseUrl,
    stop: () => stopProcess(child),
  };
}

async function waitForHealth(baseUrl: string, child: ChildProcess, logs: string[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before health check passed. Logs:\n${logs.join('\n')}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Server did not become healthy at ${baseUrl}. Logs:\n${logs.join('\n')}`);
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}