import express from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from './db/client.js';
import { activitiesRouter } from './routes/activities.js';
import { thresholdsRouter } from './routes/thresholds.js';
import { ingestRouter } from './routes/ingest.js';
import { profileRouter } from './routes/profile.js';
import { devRouter, snapshotDeploymentRouter } from './routes/dev.js';
import { createAutomaticBackupIfDue, databaseRouter } from './routes/database.js';
import { requestLogger, globalErrorHandler } from './utils/logger.js';
import { isDevToolsEnabled } from './utils/dev-mode.js';
import { getMaintenanceStatus, startMaintenance } from './jobs/maintenance.js';
import { currentDatabaseOperation } from './application/database-operations.js';

const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : (typeof import.meta !== 'undefined' && import.meta.url ? path.dirname(fileURLToPath(import.meta.url)) : process.cwd());

const launchToken = process.env.AEROLAB_SESSION_TOKEN || (process.env.NODE_ENV === 'production' ? randomBytes(32).toString('hex') : null);

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function createServer(options: { sessionToken?: string } = {}) {
  const app = express();
  const sessionToken = options.sessionToken ?? launchToken;

  // Standard Security Headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // A loopback listener alone does not stop DNS rebinding or another localhost
  // page from calling the API. Production traffic is same-origin only; Vite's
  // fixed development origin is the sole cross-origin exception.
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
      return res.status(403).json({ error: 'Invalid local host.' });
    }
    const origin = req.headers.origin;
    const devOrigin = process.env.NODE_ENV !== 'production' &&
      (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173');
    if (origin && origin !== `http://${host}` && !devOrigin) {
      return res.status(403).json({ error: 'Origin not authorized.' });
    }
    if (devOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  if (sessionToken) {
    const sessionCookieToken = randomBytes(32).toString('hex');
    let bootstrapAvailable = true;
    app.get(`/bootstrap/${sessionToken}`, (_req, res) => {
      if (!bootstrapAvailable) return res.sendStatus(404);
      bootstrapAvailable = false;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.cookie('aerolab_session', sessionCookieToken, {
        httpOnly: true,
        sameSite: 'strict',
        path: '/'
      });
      res.redirect(302, '/');
    });
    app.use('/api', (req, res, next) => {
      if (req.path === '/health') return next();
      const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('aerolab_session='));
      const value = cookie?.slice('aerolab_session='.length);
      if (!tokenMatches(value, sessionCookieToken)) return res.status(401).json({ error: 'Local session required.' });
      next();
    });
  }

  // Base64 snapshots and activity imports have separate ceilings. Ordinary
  // API calls use a much smaller global JSON parser.
  app.use('/api/database/restore', express.json({ limit: '160mb' }));
  app.use('/api/ingest/upload', express.json({ limit: '64mb' }));
  app.use('/api/ingest/upload-batch', express.json({ limit: '64mb' }));
  app.use('/api/ingest/jobs', express.json({ limit: '64mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);
  app.use('/api', (req, res, next) => {
    const operation = currentDatabaseOperation();
    if (operation && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !(operation === 'import' && req.path.startsWith('/ingest/jobs/'))) {
      return res.status(409).json({ code: operation === 'import' ? 'ERR_IMPORT_BUSY' : 'DATABASE_BUSY', error: 'Wait for the current database operation to finish.' });
    }
    next();
  });

  // API Routes
  app.use('/api/activities', activitiesRouter);
  app.use('/api/thresholds', thresholdsRouter);
  app.use('/api/ingest', ingestRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/snapshot-deploy', snapshotDeploymentRouter);
  // Developer diagnostics are a development-only surface. In a production build
  // this router is never mounted, so /api/dev/* falls through to the API 404
  // handler and no internal telemetry is reachable from a shipped installer.
  if (isDevToolsEnabled()) {
    app.use('/api/dev', devRouter);
  }
  app.use('/api/database', databaseRouter);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/system/maintenance', (_req, res) => {
    res.json(getMaintenanceStatus());
  });

  // Graceful shutdown for standalone desktop app mode (loopback only)
  app.post('/api/system/shutdown', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    // Only loopback connections may terminate the local engine. This check is
    // never bypassed, including in automated test runs.
    if (!isLoopback) {
      return res.status(403).json({ error: 'Shutdown command rejected: only loopback connections authorized.' });
    }

    res.json({ ok: true, message: 'Shutting down AEROLAB...' });
    setTimeout(() => {
      try {
        closeDatabase();
      } catch { /* intentionally ignored: non-fatal */ }
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

const PORT = Number(process.env.PORT || 3001);

export function listenOnLoopback(app: ReturnType<typeof createServer>, port: number, onListening?: () => void) {
  return app.listen(port, '127.0.0.1', onListening);
}

// Only listen if executed directly
if (process.env.NODE_ENV !== 'test') {
  const app = createServer();
  // Only schema setup is required before serving requests. Derived data is
  // computed in a local worker after the listener is ready.
  process.env.AEROLAB_DEFER_MIGRATIONS = '1';
  const db = getDatabase();

  listenOnLoopback(app, PORT, () => {
    try {
      const backup = createAutomaticBackupIfDue(db);
      if (backup) console.log(`🗄️ Automatic database snapshot created: ${backup.filename}`);
    } catch (error) {
      console.error('Automatic database snapshot failed:', error);
    }
    startMaintenance(db.name);
    console.log(`\n🚀 Run Progress API server running at http://localhost:${PORT}`);
    if (launchToken && !process.env.AEROLAB_SESSION_TOKEN) {
      console.log(`Open http://127.0.0.1:${PORT}/bootstrap/${launchToken} to start a local session.`);
    }
    console.log(`📊 Activities: http://localhost:${PORT}/api/activities`);
    console.log(`📈 Thresholds: http://localhost:${PORT}/api/thresholds\n`);
  });
}
