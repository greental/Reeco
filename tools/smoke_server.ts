import { spawn } from 'node:child_process';

const API_URL = 'http://127.0.0.1:3000';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertPortIsFree(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/health`);
  } catch {
    return;
  }

  throw new Error('Port 3000 is already serving HTTP before smoke test starts');
}

async function waitForHealth(): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(`${API_URL}/api/health`);
      const body = (await response.json()) as { ok?: boolean };
      if (response.status === 200 && body.ok === true) {
        return;
      }
      lastError = new Error(`Unexpected health response: ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  throw lastError instanceof Error ? lastError : new Error('Server did not become healthy');
}

async function verifyJson404(): Promise<void> {
  const response = await fetch(`${API_URL}/api/this-route-does-not-exist`);
  const contentType = response.headers.get('content-type') ?? '';
  const body = (await response.json()) as { error?: unknown };

  if (response.status !== 404) {
    throw new Error(`Expected 404, got ${response.status}`);
  }
  if (!contentType.includes('application/json')) {
    throw new Error(`Expected application/json content-type, got ${contentType}`);
  }
  if (typeof body.error !== 'string') {
    throw new Error('Expected JSON error body with string error property');
  }
}

async function main(): Promise<void> {
  await assertPortIsFree();

  const server = spawn(process.execPath, ['dist/backend/server.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '3000' },
  });

  server.stdout.on('data', (chunk: Buffer) => process.stdout.write(chunk));
  server.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));

  try {
    await waitForHealth();
    await verifyJson404();
    console.log('Server smoke check passed.');
  } finally {
    server.kill('SIGTERM');
    await delay(500);
    if (server.exitCode === null) {
      server.kill('SIGKILL');
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
