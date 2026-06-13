import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { apiRouter } from './routes/api.js';
import { sendError } from './http/responses.js';
import { jsonErrorMiddleware } from './http/errorMiddleware.js';

export function createApp() {
  const app = express();
  const builtFrontendPath = path.join(process.cwd(), 'dist/frontend');
  const fallbackFrontendPath = path.join(process.cwd(), 'src/frontend/static');
  const frontendPath = fs.existsSync(path.join(builtFrontendPath, 'index.html')) ? builtFrontendPath : fallbackFrontendPath;

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter);
  app.use('/assets', express.static(path.join(builtFrontendPath, 'assets')));
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

  app.use(jsonErrorMiddleware);

  return app;
}
