import { reserveDatabaseOperation, currentDatabaseOperation, onDatabaseIdle } from '../application/database-operations.js';
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getDatabaseConfigPath } from '../db/path.js';
import { logger } from '../utils/logger.js';

export interface MaintenanceStatus {
  status: 'idle' | 'running' | 'complete' | 'failed' | 'interrupted';
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  completedMigrations?: number;
  syncedActivitiesCount?: number;
  task?: 'startup' | 'profile';
}

let worker: Worker | null = null;
let status: MaintenanceStatus = { status: 'idle' };
let queuedProfile: { databasePath: string; baselineChanged: boolean } | null = null;
let queuedStartup: { databasePath: string; onComplete?: () => void } | null = null;

function statusPath(): string {
  return getDatabaseConfigPath().replace(/database-location\.json$/, 'maintenance-status.json');
}

function saveStatus(next: MaintenanceStatus): void {
  status = next;
  const file = statusPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}

export function getMaintenanceStatus(): MaintenanceStatus {
  if (status.status !== 'idle') return status;
  try {
    const saved = JSON.parse(fs.readFileSync(statusPath(), 'utf8')) as MaintenanceStatus;
    return saved.status === 'running' ? { ...saved, status: 'interrupted' } : saved;
  } catch {
    return status;
  }
}

/** A separate thread keeps SQLite recomputation from blocking the local API. */
export function startMaintenance(databasePath: string, onComplete?: () => void, task: 'startup' | 'profile' = 'startup', baselineChanged = false): void {
  if (worker || currentDatabaseOperation()) {
    if (task === 'profile') queuedProfile = { databasePath, baselineChanged: Boolean(queuedProfile?.baselineChanged || baselineChanged) };
    else if (!worker) queuedStartup = { databasePath, onComplete };
    return;
  }
  const lease = reserveDatabaseOperation('maintenance');
  const startedAt = new Date().toISOString();
  const sourceDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  const production = process.env.NODE_ENV === 'production';
  const repoRoot = path.resolve(sourceDir, '..', '..', '..');
  const entry = production
    ? path.join(sourceDir, 'maintenance-worker.cjs')
    : path.join(repoRoot, 'dist-backend', 'maintenance-worker-dev.cjs');
  let completed = false;
  let terminal: MaintenanceStatus | null = null;
  try {
    saveStatus({ status: 'running', startedAt, task });
    if (!production) {
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      execFileSync(process.execPath, [
        path.join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild'),
        path.join(sourceDir, 'maintenance-worker.ts'), '--bundle', '--platform=node', '--format=cjs',
        '--external:better-sqlite3', '--define:import.meta.url="undefined"', '--log-override:empty-import-meta=silent',
        `--outfile=${entry}`
      ], { stdio: 'ignore' });
    }
    if (!fs.existsSync(entry)) throw new Error(`Maintenance worker bundle missing: ${entry}`);
    worker = new Worker(entry, {
      workerData: { databasePath, task, baselineChanged },
      env: { ...process.env, AEROLAB_DEFER_MIGRATIONS: '0' },
      execArgv: []
    });
  } catch (error) {
    saveStatus({ status: 'failed', startedAt, finishedAt: new Date().toISOString(), error: String(error) });
    worker = null;
    lease.release();
    return;
  }
  worker.on('message', (message: MaintenanceStatus) => {
    if (message.status === 'complete') {
      completed = true;
      terminal = { status: 'complete', startedAt, finishedAt: new Date().toISOString(), completedMigrations: message.completedMigrations, syncedActivitiesCount: message.syncedActivitiesCount, task };
    } else if (message.status === 'failed') {
      saveStatus({ status: 'failed', startedAt, finishedAt: new Date().toISOString(), error: message.error });
      logger.error('DB', 'Background maintenance failed', message.error);
    }
  });
  worker.on('error', error => {
    saveStatus({ status: 'failed', startedAt, finishedAt: new Date().toISOString(), error: error.message });
    logger.error('DB', 'Background maintenance worker failed', error);
  });
  worker.on('exit', code => {
    if (!completed && getMaintenanceStatus().status === 'running') {
      saveStatus({ status: 'interrupted', startedAt, finishedAt: new Date().toISOString(), error: `Worker exited with code ${code}` });
    }
    worker = null;
    lease.release();
    if (terminal) saveStatus(terminal);
    if (completed) onComplete?.();
    if (queuedProfile) {
      const queued = queuedProfile;
      queuedProfile = null;
      startMaintenance(queued.databasePath, undefined, 'profile', queued.baselineChanged);
    }
  });
}

export function queueProfileRecompute(databasePath: string, baselineChanged: boolean): void {
  startMaintenance(databasePath, undefined, 'profile', baselineChanged);
}

export function isMaintenanceRunning(): boolean {
  return worker !== null || queuedProfile !== null || queuedStartup !== null;
}

// Profile writes arriving during another operation retain the strongest refresh request.
onDatabaseIdle(() => {
  if (!worker && !currentDatabaseOperation() && queuedProfile) {
    const queued = queuedProfile;
    queuedProfile = null;
    startMaintenance(queued.databasePath, undefined, 'profile', queued.baselineChanged);
  } else if (!worker && !currentDatabaseOperation() && queuedStartup) {
    const queued = queuedStartup;
    queuedStartup = null;
    startMaintenance(queued.databasePath, queued.onComplete);
  }
});
