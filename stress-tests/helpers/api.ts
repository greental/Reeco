export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
  ok: boolean;
  responseTime: number;
}

export async function api<T = unknown>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { Accept: 'application/json', 'Content-Type': 'application/json' } : { Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseTime = performance.now() - started;
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json')
    ? ((await response.json()) as T)
    : ((await response.text()) as T);

  return { status: response.status, data, headers: response.headers, ok: response.ok, responseTime };
}

export const get = <T = unknown>(baseUrl: string, path: string) => api<T>(baseUrl, 'GET', path);
export const patch = <T = unknown>(baseUrl: string, path: string, body?: unknown) => api<T>(baseUrl, 'PATCH', path, body);

export function getBaseUrl(): string {
  return process.env.API_URL ?? 'http://localhost:3000';
}

export async function expectOk<T = unknown>(baseUrl: string, path: string): Promise<ApiResponse<T>> {
  const response = await get<T>(baseUrl, path);
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(response.data)}`);
  }
  return response;
}