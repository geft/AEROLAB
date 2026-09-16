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
import Database from 'better-sqlite3';
import { realignDatabase } from '../src/backend/db/realign.js';

const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'runs.db');
const onlyIds = process.argv.slice(2).filter(a => !a.startsWith('-'));

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

// Open with a busy timeout so a running dev server doesn't cause SQLITE_BUSY.
const db = new Database(dbPath, { timeout: 30000 });
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
}

const stats = realignDatabase(db, {
  logger: (msg) => console.log(`[realign] ${msg}`),
  activityIds: onlyIds.length > 0 ? onlyIds : undefined
});
db.close();

console.log('---');
console.log(JSON.stringify(stats, null, 1));
if (stats.activitiesFailed.length > 0) {
  process.exitCode = 1;
}
