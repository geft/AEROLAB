import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COMPACTION_MIN_DATABASE_BYTES, COMPACTION_MIN_RECLAIMABLE_BYTES,
  compactDatabase, measureStorageFootprint, shouldCompact
} from '../../src/backend/db/compaction.js';

const MB = 1024 * 1024;

let directory: string;
let databasePath: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-compaction-'));
  databasePath = path.join(directory, 'runs.db');
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

/** Reproduce the import pattern: write wide rows, then clear the payload. */
function fragmentDatabase(db: Database.Database): void {
  db.exec('CREATE TABLE activity_records (id INTEGER PRIMARY KEY, payload TEXT)');
  const insert = db.prepare('INSERT INTO activity_records(payload) VALUES (?)');
  const payload = 'x'.repeat(2048);
  db.transaction(() => {
    for (let index = 0; index < 4_000; index++) insert.run(payload);
  })();
  db.prepare('UPDATE activity_records SET payload = NULL').run();
}

describe('storage footprint', () => {
  it('counts unused page space left by shrinking updates and reclaims it by compacting', () => {
    const db = new Database(databasePath);
    try {
      db.pragma('journal_mode = WAL');
      fragmentDatabase(db);
      db.pragma('wal_checkpoint(TRUNCATE)');
      const before = measureStorageFootprint(db);
      expect(before.databaseBytes).toBe(fs.statSync(databasePath).size);
      expect(before.reclaimableBytes).toBeGreaterThan(0);

      const result = compactDatabase(db);
      expect(result.reclaimedBytes).toBeGreaterThan(0);
      expect(result.databaseBytes).toBeLessThan(before.databaseBytes);
      expect(result.reclaimableBytes).toBeLessThan(before.reclaimableBytes);
      expect(db.prepare('SELECT COUNT(*) AS n FROM activity_records').get()).toEqual({ n: 4_000 });
    } finally {
      db.close();
    }
  });

  it('keeps a fresh file small and reports no reclaimable space', () => {
    const db = new Database(databasePath);
    try {
      db.exec('CREATE TABLE activity_records (id INTEGER PRIMARY KEY, payload TEXT)');
      expect(measureStorageFootprint(db).reclaimableBytes).toBeLessThan(64 * 1024);
      expect(shouldCompact(measureStorageFootprint(db))).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe('automatic compaction policy', () => {
  it('requires a large file, enough reclaimable bytes and a meaningful ratio', () => {
    expect(COMPACTION_MIN_RECLAIMABLE_BYTES).toBeLessThan(COMPACTION_MIN_DATABASE_BYTES);
    expect(shouldCompact({ databaseBytes: 200 * MB, reclaimableBytes: 40 * MB })).toBe(true);
    expect(shouldCompact({ databaseBytes: 200 * MB, reclaimableBytes: 20 * MB })).toBe(false);
    expect(shouldCompact({ databaseBytes: 400 * MB, reclaimableBytes: 40 * MB })).toBe(false);
    expect(shouldCompact({ databaseBytes: 60 * MB, reclaimableBytes: 50 * MB })).toBe(false);
  });
});
