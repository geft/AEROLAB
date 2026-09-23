import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { createMigrationRunner } from '../../src/backend/db/migrations.js';

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
});
