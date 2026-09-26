import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { createMigrationRunner } from '../../src/backend/db/migrations.js';
import { openDatabase } from '../../src/backend/db/client.js';

describe('named database migrations', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('rolls back an interrupted step and retries it on the next start', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-migration-'));
    roots.push(root);
    const db = new Database(path.join(root, 'runs.db'));
    db.exec('CREATE TABLE activities (id TEXT PRIMARY KEY, value INTEGER); INSERT INTO activities VALUES (\'a\', 1)');

    const first = createMigrationRunner(db);
    expect(first.run('update-value', () => {
      db.prepare('UPDATE activities SET value = 2').run();
      throw new Error('interrupted');
    })).toBe(false);
    expect((db.prepare('SELECT value FROM activities').get() as { value: number }).value).toBe(1);
    expect(first.snapshotPath && fs.existsSync(first.snapshotPath)).toBe(true);

    const retry = createMigrationRunner(db);
    expect(retry.run('update-value', () => db.prepare('UPDATE activities SET value = 3').run())).toBe(true);
    expect((db.prepare('SELECT value FROM activities').get() as { value: number }).value).toBe(3);
    expect(retry.run('update-value', () => { throw new Error('should not repeat'); })).toBe(true);
    db.close();
  });

  it('maps a completed legacy migration marker to named steps', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE activities (id TEXT PRIMARY KEY); PRAGMA user_version = 1');
    const runner = createMigrationRunner(db);
    expect(runner.run('centroid-v1', () => { throw new Error('already complete'); })).toBe(true);
    db.close();
  });

  it('checkpoints legacy column additions and does not rerun them on reopen', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-schema-migration-'));
    roots.push(root);
    const file = path.join(root, 'legacy.db');
    const legacy = new Database(file);
    legacy.exec("CREATE TABLE activities (id TEXT PRIMARY KEY, start_time TEXT NOT NULL, run_type TEXT, notes TEXT)");
    legacy.close();

    const previousDefer = process.env.AEROLAB_DEFER_MIGRATIONS;
    process.env.AEROLAB_DEFER_MIGRATIONS = '1';
    try {
      const first = openDatabase(file);
      const firstColumns = first.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>;
      expect(firstColumns.some(column => column.name === 'weather_source')).toBe(true);
      expect(firstColumns.some(column => column.name === 'notes')).toBe(false);
      expect(first.prepare("SELECT 1 FROM schema_migrations WHERE name = 'schema-columns-v1'").get()).toBeTruthy();
      first.close();

      const reopened = openDatabase(file);
      expect(reopened.prepare("SELECT count(*) AS count FROM schema_migrations WHERE name = 'schema-columns-v1'").get()).toEqual({ count: 1 });
      reopened.close();
    } finally {
      if (previousDefer === undefined) delete process.env.AEROLAB_DEFER_MIGRATIONS;
      else process.env.AEROLAB_DEFER_MIGRATIONS = previousDefer;
    }
  });

  it('adds weather PM2.5 to databases that already completed the older column migration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-weather-migration-'));
    roots.push(root);
    const file = path.join(root, 'legacy.db');
    const legacy = new Database(file);
    legacy.exec(fs.readFileSync(path.resolve('src/backend/db/schema.sql'), 'utf8'));
    legacy.exec(`
      ALTER TABLE activities DROP COLUMN weather_pm25_ug_m3;
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations (name) VALUES ('schema-columns-v1');
    `);
    legacy.close();

    const previousDefer = process.env.AEROLAB_DEFER_MIGRATIONS;
    process.env.AEROLAB_DEFER_MIGRATIONS = '1';
    try {
      const migrated = openDatabase(file);
      const columns = migrated.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>;
      expect(columns.some(column => column.name === 'weather_pm25_ug_m3')).toBe(true);
      expect(migrated.prepare("SELECT 1 FROM schema_migrations WHERE name = 'weather-pm25-v1'").get()).toBeTruthy();
      migrated.close();
    } finally {
      if (previousDefer === undefined) delete process.env.AEROLAB_DEFER_MIGRATIONS;
      else process.env.AEROLAB_DEFER_MIGRATIONS = previousDefer;
    }
  });
});
