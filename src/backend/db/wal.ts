import fs from 'node:fs';
import type Database from 'better-sqlite3';

const WAL_LIMIT_BYTES = 16 * 1024 * 1024;

export function configureWal(db: Database.Database): void {
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma(`journal_size_limit = ${WAL_LIMIT_BYTES}`);
}

/** Busy readers/writers retain their WAL; the next idle check retries safely. */
export function checkpointWal(db: Database.Database): boolean {
  if (!db.open || db.inTransaction) return false;
  const timeout = db.pragma('busy_timeout', { simple: true }) as number;
  try {
    // Idle maintenance must never wait on a worker or another app instance.
    db.pragma('busy_timeout = 0');
    const result = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
    return result.every(row => row.busy === 0);
  } finally {
    db.pragma(`busy_timeout = ${timeout}`);
  }
}

export function maintainWal(db: Database.Database): void {
  if (db.name === ':memory:' || !db.open || db.inTransaction) return;
  try {
    if (fs.statSync(`${db.name}-wal`).size >= WAL_LIMIT_BYTES) checkpointWal(db);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
