import fs from 'node:fs';
import type Database from 'better-sqlite3';

/** File-level storage facts for the local SQLite database. */
export interface StorageFootprint {
  /** Bytes of the main database file. The WAL is reported by SQLite separately. */
  databaseBytes: number;
  /** Bytes SQLite holds as unused page space plus pages on the freelist. */
  reclaimableBytes: number;
}

/** Automatic compaction only considers databases worth rewriting. */
export const COMPACTION_MIN_DATABASE_BYTES = 64 * 1024 * 1024;
/** Reclaimable space below this is normal page slack, not a reason to rewrite. */
export const COMPACTION_MIN_RECLAIMABLE_BYTES = 32 * 1024 * 1024;
export const COMPACTION_MIN_RECLAIMABLE_RATIO = 0.15;

export interface CompactionResult extends StorageFootprint {
  reclaimedBytes: number;
}

function fileBytes(db: Database.Database): number {
  if (db.name !== ':memory:') {
    try { return fs.statSync(db.name).size; } catch { /* fall back to page accounting */ }
  }
  return Number(db.pragma('page_size', { simple: true })) * Number(db.pragma('page_count', { simple: true }));
}

/**
 * Unused bytes inside pages (left by shrinking UPDATEs such as clearing archived
 * record JSON) plus free pages. Only a full VACUUM repacks the former, so this is
 * the number to compare against the file size.
 */
export function measureStorageFootprint(db: Database.Database): StorageFootprint {
  let reclaimableBytes = 0;
  try {
    const row = db.prepare('SELECT COALESCE(SUM(unused), 0) AS unused FROM dbstat').get() as { unused: number } | undefined;
    reclaimableBytes += Number(row?.unused ?? 0);
  } catch { /* dbstat is optional; the freelist below still counts */ }
  try {
    reclaimableBytes += Number(db.pragma('page_size', { simple: true })) * Number(db.pragma('freelist_count', { simple: true }));
  } catch { /* keep the dbstat estimate */ }
  return { databaseBytes: fileBytes(db), reclaimableBytes: Math.max(0, reclaimableBytes) };
}

export function shouldCompact(footprint: StorageFootprint): boolean {
  return footprint.databaseBytes >= COMPACTION_MIN_DATABASE_BYTES
    && footprint.reclaimableBytes >= COMPACTION_MIN_RECLAIMABLE_BYTES
    && footprint.reclaimableBytes / footprint.databaseBytes >= COMPACTION_MIN_RECLAIMABLE_RATIO;
}

/** Rewrites the file in place; callers own concurrency (worker thread or idle app). */
export function compactDatabase(db: Database.Database): CompactionResult {
  const before = measureStorageFootprint(db);
  db.pragma('busy_timeout = 60000');
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* VACUUM still sees the WAL */ }
  db.exec('VACUUM');
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best-effort WAL cleanup */ }
  const after = measureStorageFootprint(db);
  return { ...after, reclaimedBytes: Math.max(0, before.databaseBytes - after.databaseBytes) };
}
