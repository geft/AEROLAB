import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

const LEGACY_DERIVED_MIGRATIONS = [
  'centroid-v1',
  'steady-state-v1',
  'decoupling-v1',
  'coach-summaries-v1',
  'training-load-v1',
  'realign-v1'
] as const;

export const DERIVED_MIGRATIONS = [...LEGACY_DERIVED_MIGRATIONS, 'continuous-race-v1', 'signal-classification-v1', 'effort-structure-v1', 'stride-recovery-v1', 'historical-fitness-v1'] as const;

/** Run each data change once, with a rollback boundary and a pre-change snapshot. */
export function createMigrationRunner(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // Version 1 was the old all-in-one migration. Preserve its completed work.
  if ((db.pragma('user_version', { simple: true }) as number) >= 1) {
    const mark = db.prepare('INSERT OR IGNORE INTO schema_migrations (name) VALUES (?)');
    db.transaction(() => { for (const name of LEGACY_DERIVED_MIGRATIONS) mark.run(name); })();
  }

  let failed = false;
  let snapshotPath: string | null = null;
  const completed = db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?');
  const mark = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

  function snapshotIfNeeded(): void {
    if (snapshotPath || db.name === ':memory:') return;
    const count = (db.prepare('SELECT count(*) AS count FROM activities').get() as { count: number }).count;
    if (count === 0) return;
    const backupDir = path.join(path.dirname(db.name), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    snapshotPath = path.join(backupDir, `pre-migration-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
    logger.info('DB', `Migration safety snapshot: ${snapshotPath}`);
  }

  return {
    run(name: string, change: () => void): boolean {
      if (completed.get(name)) return true;
      if (failed) return false;
      try {
        snapshotIfNeeded();
        db.transaction(() => { change(); mark.run(name); })();
        logger.info('DB', `Migration completed: ${name}`);
        return true;
      } catch (error) {
        failed = true;
        logger.error('DB', `Migration failed: ${name}`, error);
        return false;
      }
    },
    get failed() { return failed; },
    get snapshotPath() { return snapshotPath; }
  };
}
