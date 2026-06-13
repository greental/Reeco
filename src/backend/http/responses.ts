import type { Response } from 'express';

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: unknown[];
}

export function sendError(
  res: Response,
  status: number,
  error: string,
  code = 'ERROR',
  details?: unknown[],
): Response<ApiErrorBody> {
  const body: ApiErrorBody = { error, code };
  if (details !== undefined) {
    body.details = details;
  }
  return res.status(status).json(body);
}
