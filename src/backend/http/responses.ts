import type { Response } from 'express';

export interface ApiErrorBody {
  error: string;
  code?: string;
}

export function sendError(
  res: Response,
  status: number,
  error: string,
  code = 'ERROR',
): Response<ApiErrorBody> {
  return res.status(status).json({ error, code });
}
