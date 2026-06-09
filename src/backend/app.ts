import express from 'express';
import { apiRouter } from './routes/api.js';
import { sendError } from './http/responses.js';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter);

  app.use((_req, res) => {
    sendError(res, 404, 'Route not found', 'NOT_FOUND');
  });

  return app;
}
