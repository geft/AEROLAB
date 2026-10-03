import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { compressActivity, decodeSourceFit, decodeStoredJson, loadArchivedFields, loadExportFields, migrateCompression } from '../../src/backend/db/compression.js';
import { checkpointWal, configureWal, maintainWal } from '../../src/backend/db/wal.js';

function fixture(db: Database.Database): void {
  db.exec(fs.readFileSync(path.resolve('src/backend/db/schema.sql'), 'utf8'));
  db.prepare("INSERT INTO activities(id,start_time) VALUES('run','2026-01-01')").run();
  const insert = db.prepare("INSERT INTO activity_records(activity_id,timestamp,elapsed_seconds,speed_mps,fit_fields_json) VALUES('run','2026-01-01',?,?,?)");
  insert.run(0, 3.123456789, '{ "developer": 1.23456789012345, "unknown": [1,2] }');
  insert.run(1, 3.987654321, null);
  insert.run(2, 3.333333333, '{"developer":null}');
  db.prepare("INSERT INTO activity_fit_details VALUES('run',?,?)").run('{ "unknown": [1.23456789012345] }', Buffer.from([0, 1, 2, 255]));
}

describe('lossless database storage', () => {
  it('preserves exact JSON text, FIT bytes and numeric samples; repeated compression is idempotent', () => {
    const db = new Database(':memory:');
    try {
      fixture(db);
      const original = loadExportFields(db, 'run');
      const before = db.prepare('SELECT speed_mps FROM activity_records ORDER BY id').all();
      db.transaction(() => migrateCompression(db))();
      const stored = db.prepare('SELECT metadata_json,source_fit FROM activity_fit_details').get() as { metadata_json: Buffer; source_fit: Buffer };
      expect(Buffer.isBuffer(stored.metadata_json)).toBe(true);
      expect(decodeStoredJson(stored.metadata_json)).toBe('{ "unknown": [1.23456789012345] }');
      expect(decodeSourceFit(stored.source_fit)).toEqual(Buffer.from([0, 1, 2, 255]));
      expect(loadExportFields(db, 'run')).toEqual(original);
      expect(db.prepare('SELECT speed_mps FROM activity_records ORDER BY id').all()).toEqual(before);
      expect(db.prepare('SELECT count(*) n FROM activity_records WHERE fit_fields_json IS NOT NULL').get()).toEqual({ n: 0 });
      db.transaction(() => compressActivity(db, 'run'))();
      expect(db.prepare('SELECT metadata_json,source_fit FROM activity_fit_details').get()).toEqual(stored);
      expect(loadExportFields(db, 'run')).toEqual(original);
      db.pragma('foreign_keys = ON');
      db.prepare("DELETE FROM activities WHERE id='run'").run();
      expect(db.prepare('SELECT count(*) n FROM activity_record_archives').get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });

  it('rolls back archive writes and original field removal together', () => {
    const db = new Database(':memory:');
    try {
      fixture(db);
      const original = loadExportFields(db, 'run');
      expect(() => db.transaction(() => { compressActivity(db, 'run'); throw new Error('cancel'); })()).toThrow('cancel');
      expect(loadExportFields(db, 'run')).toEqual(original);
      expect(loadArchivedFields(db, 'run').size).toBe(0);
      db.prepare('INSERT INTO activity_record_archives VALUES(?,?)').run('run', gzipSync(Buffer.from('[["wrong","field"]]')));
      expect(() => loadArchivedFields(db, 'run')).toThrow('Invalid compressed');
    } finally { db.close(); }
  });

  it('reads legacy text and uncompressed FIT bytes', () => {
    expect(decodeStoredJson('{"a":1}')).toBe('{"a":1}');
    const source = Buffer.from([0, 1, 2, 255]);
    expect(decodeSourceFit(source)).toEqual(source);
  });

  it('truncates WAL automatically and defers while a reader holds a snapshot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-wal-test-'));
    const db = new Database(path.join(dir, 'runs.db'));
    const reader = new Database(db.name);
    try {
      db.pragma('journal_mode = WAL');
      configureWal(db);
      db.exec('CREATE TABLE example(value BLOB)');
      expect(checkpointWal(db)).toBe(true);
      reader.exec('BEGIN');
      reader.prepare('SELECT * FROM example').all();
      db.prepare('INSERT INTO example VALUES(?)').run(Buffer.alloc(17 * 1024 * 1024, 42));
      expect(checkpointWal(db)).toBe(false);
      expect(fs.statSync(`${db.name}-wal`).size).toBeGreaterThan(0);
      reader.exec('COMMIT');
      maintainWal(db);
      expect(fs.statSync(`${db.name}-wal`).size).toBe(0);
      expect(db.prepare('SELECT length(value) n FROM example').get()).toEqual({ n: 17 * 1024 * 1024 });
      db.exec('BEGIN');
      expect(checkpointWal(db)).toBe(false);
      db.exec('ROLLBACK');
    } finally {
      reader.close(); db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
