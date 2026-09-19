import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from './db/client.js';
import { activitiesRouter } from './routes/activities.js';
import { thresholdsRouter } from './routes/thresholds.js';
import { ingestRouter } from './routes/ingest.js';
import { profileRouter } from './routes/profile.js';
import { devRouter } from './routes/dev.js';
import { databaseRouter, checkAndRunScheduledBackup } from './routes/database.js';
import { authRouter } from './routes/auth.js';
import { requestLogger, globalErrorHandler, logger } from './utils/logger.js';

const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : (typeof import.meta !== 'undefined' && import.meta.url ? path.dirname(fileURLToPath(import.meta.url)) : process.cwd());

export function createServer() {
  const app = express();

  // Standard Security Headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Restrict CORS to local development and desktop loopback origins
  const allowedOrigins = [
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/,
    /^http:\/\/\[::1\](:\d+)?$/
  ];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, Electron, direct curl/testing)
      if (!origin) return callback(null, true);
      const isAllowed = allowedOrigins.some(pattern => pattern.test(origin));
      if (isAllowed) {
        return callback(null, true);
      }
      return callback(new Error('Cross-Origin Request Blocked: Origin not authorized by AEROLAB local security policy.'));
    },
    credentials: true
  }));

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

  // Graceful shutdown for standalone desktop app mode (loopback only)
  app.post('/api/system/shutdown', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLoopback && process.env.NODE_ENV !== 'test') {
      return res.status(403).json({ error: 'Shutdown command rejected: only loopback connections authorized.' });
    }

    res.json({ ok: true, message: 'Shutting down AEROLAB...' });
    setTimeout(() => {
      try {
        closeDatabase();
      } catch {}
      process.exit(0);
    }, 200);
  });

  // Serve static frontend assets in production / electron standalone
  const distCandidates = [
    process.env.DIST_PATH,
    path.resolve(process.cwd(), 'dist'),
    path.resolve(currentDir, '..', 'dist'),
    path.resolve(currentDir, '..', '..', 'dist'),
    path.resolve(currentDir, 'dist')
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
