import { Router, Request, Response } from 'express';
import fs from 'fs';
import { getDatabase } from '../db/client.js';
import { logger } from '../utils/logger.js';

export const devRouter = Router();

devRouter.get('/diagnostics', (req: Request, res: Response) => {
  try {
    const db = getDatabase();

    // 1. Table Counts
    let activityCount = 0;
    let intervalCount = 0;
    let splitCount = 0;
    let recordCount = 0;
    let profileData: any = null;
    let latestLt1: any = null;
    let latestLt2: any = null;

    try {
      const actRow = db.prepare('SELECT COUNT(*) as count FROM activities').get() as any;
      activityCount = actRow?.count ?? 0;
    } catch { /* optional query: schema may predate this table */ }

    try {
      const intRow = db.prepare('SELECT COUNT(*) as count FROM activity_intervals').get() as any;
      intervalCount = intRow?.count ?? 0;
    } catch { /* optional query: schema may predate this table */ }

    try {
      const splitRow = db.prepare('SELECT COUNT(*) as count FROM activity_splits').get() as any;
      splitCount = splitRow?.count ?? 0;
    } catch { /* optional query: schema may predate this table */ }

    try {
      const recRow = db.prepare('SELECT COUNT(*) as count FROM activity_records').get() as any;
      recordCount = recRow?.count ?? 0;
    } catch { /* optional query: schema may predate this table */ }

    try {
      profileData = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;
    } catch { /* optional query: schema may predate this table */ }

    try {
      latestLt1 = db.prepare('SELECT * FROM physiological_thresholds WHERE lt1_hr IS NOT NULL ORDER BY effective_date DESC LIMIT 1').get() as any;
      latestLt2 = db.prepare('SELECT * FROM physiological_thresholds WHERE lt2_hr IS NOT NULL ORDER BY effective_date DESC LIMIT 1').get() as any;
    } catch { /* optional query: schema may predate this table */ }

    // Database file stats
    const dbPath = db.name;
    let dbSizeBytes = 0;
    if (dbPath !== ':memory:' && fs.existsSync(dbPath)) {
      try {
        const stat = fs.statSync(dbPath);
        dbSizeBytes = stat.size;
      } catch { /* best-effort cleanup: safe to ignore */ }
    }

    const mem = process.memoryUsage();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryMb: {
          heapUsed: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
          heapTotal: Number((mem.heapTotal / (1024 * 1024)).toFixed(1)),
          rss: Number((mem.rss / (1024 * 1024)).toFixed(1))
        }
      },
      db: {
        path: dbPath,
        sizeMb: Number((dbSizeBytes / (1024 * 1024)).toFixed(2)),
        activityCount,
        intervalCount,
        splitCount,
        recordCount
      },
      athlete: {
        configured: Boolean(profileData?.is_configured),
        dob: profileData?.dob,
        restingHr: profileData?.resting_hr,
        maxHr: profileData?.max_hr,
        lt1Hr: profileData?.lt1_hr ?? latestLt1?.lt1_hr,
        lt2Hr: profileData?.lt2_hr ?? latestLt2?.lt2_hr,
        baselineEconomyEf: latestLt1?.baseline_economy_ef
      },
      logs: logger.getRecentLogs(60)
    });
  } catch (err: any) {
    logger.error('DEV_DIAGNOSTICS', `Failed to generate diagnostics: ${err.message}`, err);
    res.status(500).json({
      error: 'Failed to retrieve diagnostics',
      code: 'ERR_DEV_DIAGNOSTICS_FAILED',
      message: err.message
    });
  }
});

// Endpoint to simulate an error for Dev Mode verification
devRouter.post('/test-error', (req: Request, res: Response) => {
  const { code = 'ERR_TEST_SIMULATED', message = 'Simulated diagnostic test error' } = req.body || {};
  logger.warn('DEV_TEST', `Simulated test error triggered: ${message}`, { code });
  res.status(400).json({
    error: message,
    code,
    details: {
      simulated: true,
      timestamp: new Date().toISOString()
    }
  });
});
