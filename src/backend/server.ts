import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDatabase } from './db/client.js';
import { activitiesRouter } from './routes/activities.js';
import { thresholdsRouter } from './routes/thresholds.js';
import { ingestRouter } from './routes/ingest.js';
import { profileRouter } from './routes/profile.js';
import { devRouter } from './routes/dev.js';
import { databaseRouter, checkAndRunScheduledBackup } from './routes/database.js';
import { authRouter } from './routes/auth.js';
import { requestLogger, globalErrorHandler, logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(requestLogger);

  // API Routes
  app.use('/api/activities', activitiesRouter);
  app.use('/api/thresholds', thresholdsRouter);
  app.use('/api/ingest', ingestRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/dev', devRouter);
  app.use('/api/database', databaseRouter);
  app.use('/api/auth', authRouter);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Serve static frontend assets in production / electron standalone
  const distCandidates = [
    process.env.DIST_PATH,
    path.resolve(process.cwd(), 'dist'),
    path.resolve(__dirname, '..', '..', 'dist'),
    path.resolve(__dirname, 'dist')
  ].filter(Boolean) as string[];

  const distPath = distCandidates.find(p => fs.existsSync(p));
  if (distPath) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // 404 handler for unhandled API routes
  app.all('/api/*', (req, res) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl}`,
      code: 'ERR_ROUTE_NOT_FOUND',
      timestamp: new Date().toISOString()
    });
  });

  // Global error handler
  app.use(globalErrorHandler);

  return app;
}

const PORT = process.env.PORT || 3001;

// Only listen if executed directly
if (process.env.NODE_ENV !== 'test') {
  const app = createServer();
  // Ensure DB initialized
  const db = getDatabase();
  try {
    checkAndRunScheduledBackup(db);
  } catch (err: any) {
    logger.warn('server', 'Initial backup check failed', { error: err?.message || String(err) });
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Run Progress API server running at http://localhost:${PORT}`);
    console.log(`📊 Activities: http://localhost:${PORT}/api/activities`);
    console.log(`📈 Thresholds: http://localhost:${PORT}/api/thresholds\n`);
  });
}
