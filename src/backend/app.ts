import express from 'express';
import path from 'node:path';
import { apiRouter } from './routes/api.js';
import { sendError } from './http/responses.js';

export function createApp() {
  const app = express();
  const frontendPath = path.join(process.cwd(), 'src/frontend/static');

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter);
  app.use(express.static(frontendPath));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }

    res.sendFile(path.join(frontendPath, 'index.html'));
  });

  app.use((_req, res) => {
    sendError(res, 404, 'Route not found', 'NOT_FOUND');
  });

  return app;
}
