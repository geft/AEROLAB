import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDatabase } from '../db/client.js';
import { getBackupSettings, listBackups } from './database.js';
import { logger } from '../utils/logger.js';
import { isDevToolsEnabled } from '../utils/dev-mode.js';

export const devRouter = Router();

let snapshotDeploymentRunning = false;

devRouter.post('/snapshot-deploy', (req: Request, res: Response) => {
  // Snapshot export/build/deploy can take several minutes on a first run.
  res.setTimeout(0);
  if (!isDevToolsEnabled()) return res.sendStatus(404);
  if (snapshotDeploymentRunning) {
    return res.status(409).json({ error: 'A snapshot deployment is already running.', code: 'ERR_SNAPSHOT_DEPLOY_IN_PROGRESS' });
  }

  const projectRoot = process.cwd();
  const linkPath = path.join(projectRoot, '.vercel', 'project.json');
  if (!fs.existsSync(linkPath)) {
    return res.status(409).json({
      error: 'This checkout is not linked to a Vercel project.',
      code: 'ERR_VERCEL_PROJECT_NOT_LINKED'
    });
  }

  const filename = req.body?.filename;
  if (typeof filename !== 'string' || path.basename(filename) !== filename
    || !/^runs-[a-zA-Z0-9._-]+\.db$/.test(filename)) {
    return res.status(400).json({ error: 'Choose a valid local snapshot row.', code: 'ERR_INVALID_SNAPSHOT' });
  }
  let selectedSnapshot: ReturnType<typeof listBackups>[number] | undefined;
  try {
    const backupDirectory = getBackupSettings(getDatabase()).backupDirectory;
    selectedSnapshot = listBackups(backupDirectory).find(snapshot => snapshot.filename === filename);
  } catch {
    return res.status(500).json({ error: 'Could not read the local snapshot directory.', code: 'ERR_SNAPSHOT_DIRECTORY' });
  }
  if (!selectedSnapshot) {
    return res.status(404).json({ error: 'That local snapshot no longer exists. Refresh the list and retry.', code: 'ERR_SNAPSHOT_NOT_FOUND' });
  }

  try {
    const projectLink = JSON.parse(fs.readFileSync(linkPath, 'utf8')) as {
      projectId?: unknown;
      orgId?: unknown;
      projectName?: unknown;
    };
    if (typeof projectLink.projectId !== 'string' || typeof projectLink.orgId !== 'string'
      || projectLink.projectName !== 'aerolab-snapshot') {
      return res.status(409).json({
        error: 'This checkout must be linked to the aerolab-snapshot Vercel project before deploying.',
        code: 'ERR_VERCEL_PROJECT_LINK_INVALID'
      });
    }
  } catch {
    return res.status(409).json({
      error: 'This checkout must be linked to the aerolab-snapshot Vercel project before deploying.',
      code: 'ERR_VERCEL_PROJECT_LINK_INVALID'
    });
  }

  snapshotDeploymentRunning = true;
  const child = spawn(process.execPath, [path.join(projectRoot, 'scripts', 'deploy-snapshot.js')], {
    cwd: projectRoot,
    env: { ...process.env, AEROLAB_SNAPSHOT_DATABASE_PATH: selectedSnapshot.filePath },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  const appendOutput = (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-16_000);
  };
  child.stdout.on('data', appendOutput);
  child.stderr.on('data', appendOutput);
  child.on('error', error => {
    snapshotDeploymentRunning = false;
    logger.error('DEV_SNAPSHOT_DEPLOY', `Unable to start snapshot deployment: ${error.message}`);
    if (!res.headersSent) res.status(500).json({ error: error.message, code: 'ERR_SNAPSHOT_DEPLOY_START' });
  });
  child.on('close', code => {
    snapshotDeploymentRunning = false;
    const deploymentUrl = [...output.matchAll(/https?:\/\/[^\s"'<>]+\.vercel\.app/gi)].at(-1)?.[0] ?? null;
    if (code !== 0 || !deploymentUrl) {
      const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
      const details = output.replace(ansiEscape, '').trim().slice(-2_000);
      const message = details || 'Snapshot deployment command failed without additional output.';
      logger.error('DEV_SNAPSHOT_DEPLOY', message);
      if (!res.headersSent) {
        return res.status(500).json({ error: message, code: 'ERR_SNAPSHOT_DEPLOY_FAILED' });
      }
      return;
    }

    logger.info('DEV_SNAPSHOT_DEPLOY', `Snapshot deployed to ${deploymentUrl}`);
    if (!res.headersSent) res.json({ deploymentUrl });
  });
});

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
