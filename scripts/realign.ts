import { pruneBackupFiles } from '../src/backend/db/backup-retention.js';
/**
 * Force-realign stored analysis with the current detection/classification code.
 *
 * Usage:
 *   npm run realign                  # realign all activities (backs up first)
 *   npm run realign -- <activity-id> # realign one activity (no backup needed)
 *
 * Backs up data/runs.db to data/backups/ before touching anything.
 */
import fs from 'fs';
import path from 'path';
import { getDatabasePath } from '../src/backend/db/path.js';
import Database from 'better-sqlite3';
import { realignDatabase } from '../src/backend/db/realign.js';
import { openDatabase } from '../src/backend/db/client.js';

const dbPath = getDatabasePath();
const onlyIds = process.argv.slice(2).filter(a => !a.startsWith('-'));

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

// Open with a busy timeout so a running dev server doesn't cause SQLITE_BUSY.
let db = new Database(dbPath, { timeout: 30000 });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

if (onlyIds.length === 0) {
  // Transactionally consistent online backup (safe while the server runs).
  const backupDir = path.resolve(path.dirname(dbPath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `runs-${stamp}.db`);
  db.prepare(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`).run();
  console.log(`Backup written to ${backupPath}`);
  pruneBackupFiles(backupDir, backupPath);
}

const startedAt = Date.now();
let lastReportAt = 0;
let currentPhase: 'replay' | 'coach' | undefined;
let phaseStartedAt = startedAt;
let phaseBase = 0;

function durationText(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, seconds).toFixed(0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m${String(rest).padStart(2, '0')}s`;
}

/** A full replay is minutes of silence otherwise; report at most every 3 seconds. */
function report(completed: number, total: number, phase: 'replay' | 'coach' = 'replay'): void {
  const now = Date.now();
  if (phase !== currentPhase) {
    currentPhase = phase;
    phaseStartedAt = now;
    phaseBase = completed - 1;
  }
  if (completed < total && now - lastReportAt < 3000) return;
  lastReportAt = now;
  const elapsed = (now - startedAt) / 1000;
  const phaseElapsed = (now - phaseStartedAt) / 1000;
  const done = Math.max(1, completed - phaseBase);
  const perActivity = phaseElapsed / done;
  const remaining = Math.max(0, total - completed) * perActivity;
  const percent = total === 0 ? 100 : Math.round((100 * completed) / total);
  const label = phase === 'coach' ? 'coach summaries' : 'activities';
  console.log(`[realign] ${label.padEnd(16)} ${String(completed).padStart(4)}/${total} ${String(percent).padStart(3)}%  ` +
    `${perActivity.toFixed(2)} s/activity  elapsed ${durationText(elapsed)}  eta ${durationText(remaining)}`);
}

// Upgrade schema only after the backup exists, just as application startup does.
db.close();
db = openDatabase(dbPath);
db.pragma('busy_timeout = 30000');
console.log(`[realign] database: ${dbPath}`);
const stats = realignDatabase(db, {
  logger: (msg) => console.log(`[realign] ${msg}`),
  activityIds: onlyIds.length > 0 ? onlyIds : undefined,
  onProgress: report
});
db.close();

console.log('---');
console.log(JSON.stringify(stats, null, 1));
if (stats.activitiesFailed.length > 0) {
  process.exitCode = 1;
}
