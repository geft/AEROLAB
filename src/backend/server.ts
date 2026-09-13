import express from 'express';
import cors from 'cors';
import { getDatabase } from './db/client.js';
import { activitiesRouter } from './routes/activities.js';
import { thresholdsRouter } from './routes/thresholds.js';
import { ingestRouter } from './routes/ingest.js';
import { profileRouter } from './routes/profile.js';

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.use('/api/activities', activitiesRouter);
  app.use('/api/thresholds', thresholdsRouter);
  app.use('/api/ingest', ingestRouter);
  app.use('/api/profile', profileRouter);

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}

const PORT = process.env.PORT || 3001;

// Only listen if executed directly
if (process.env.NODE_ENV !== 'test') {
  const app = createServer();
  // Ensure DB initialized
  getDatabase();

  app.listen(PORT, () => {
    console.log(`\n🚀 Run Progress API server running at http://localhost:${PORT}`);
    console.log(`📊 Activities: http://localhost:${PORT}/api/activities`);
    console.log(`📈 Thresholds: http://localhost:${PORT}/api/thresholds\n`);
  });
}
