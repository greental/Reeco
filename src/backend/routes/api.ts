import { Router } from 'express';
import { sendError } from '../http/responses.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

apiRouter.use((_req, res) => {
  sendError(res, 404, 'API route not found', 'NOT_FOUND');
});
