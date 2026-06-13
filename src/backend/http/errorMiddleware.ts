import type { ErrorRequestHandler } from 'express';
import { sendError } from './responses.js';

interface HttpErrorLike extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

export const jsonErrorMiddleware: ErrorRequestHandler = (error: HttpErrorLike, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error.type === 'entity.parse.failed') {
    sendError(res, 400, 'Invalid JSON body', 'INVALID_JSON');
    return;
  }

  const status = error.statusCode ?? error.status ?? 500;
  if (status >= 400 && status < 500) {
    sendError(res, status, error.message || 'Invalid request', 'BAD_REQUEST');
    return;
  }

  console.error('Unhandled API error', error);
  sendError(res, 500, 'Unexpected server error', 'INTERNAL_ERROR');
};