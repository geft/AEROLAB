import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer, listenOnLoopback } from '../../src/backend/server.js';
import * as client from '../../src/backend/db/client.js';
import { restoreDatabaseFromFile, validateDatabaseSnapshot } from '../../src/backend/routes/database.js';
import { importRunContent } from '../../src/backend/ingestion/importer.js';
import { getBenchmark, toCsv } from '../fixtures/benchmark-runs.js';

describe('Audit security and data integrity regressions', () => {
  let directory: string;
  let activePath: string;
  let previousPath: string | undefined;
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    previousPath = process.env.DATABASE_PATH;
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-regression-'));
    activePath = path.join(directory, 'active.db');
    process.env.DATABASE_PATH = activePath;
    client.getDatabase(activePath).prepare("INSERT INTO activities (id, start_time) VALUES ('original', '2026-01-01')").run();
    app = createServer();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network disabled in regression tests')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    client.closeDatabase();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function donor() {
    const donorPath = path.join(directory, 'donor.db');
    const db = client.openDatabase(donorPath, true);
    db.prepare("INSERT INTO activities (id, start_time) VALUES ('replacement', '2026-02-01')").run();
    db.close();
    return donorPath;
  }

  function expectOriginal() {
    expect(client.getDatabase().prepare('SELECT id FROM activities').all())
      .toEqual([{ id: 'original' }]);
  }

  it('binds the real listener only to IPv4 loopback', async () => {
    const server = listenOnLoopback(app, 0);
    try {
      await new Promise<void>(resolve => server.once('listening', resolve));
      expect(server.address()).toMatchObject({ address: '127.0.0.1' });
      expect((await request(server).get('/api/health')).status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    }
  });

  it('rejects an incompatible activities table without closing or replacing the live database', () => {
    const candidatePath = path.join(directory, 'invalid.db');
    const candidate = new Database(candidatePath);
    candidate.exec('CREATE TABLE activities (unrelated TEXT)');
    candidate.close();
    const original = client.getDatabase();
    expect(validateDatabaseSnapshot(candidatePath).valid).toBe(false);
    expect(restoreDatabaseFromFile(candidatePath).success).toBe(false);
    expect(client.getDatabase()).toBe(original);
    expectOriginal();
  });

  it('rejects a broken secondary schema during staging while preserving the original', () => {
    const candidatePath = donor();
    const candidate = new Database(candidatePath);
    candidate.exec('DROP TABLE activity_records; CREATE TABLE activity_records (unrelated TEXT)');
    candidate.close();
    expect(restoreDatabaseFromFile(candidatePath).success).toBe(false);
    expectOriginal();
  });

  it('aborts when the safety backup fails', () => {
    const candidatePath = donor();
    const db = client.getDatabase();
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
      if (sql.startsWith('VACUUM INTO')) throw new Error('simulated backup failure');
      return prepare(sql);
    }) as typeof db.prepare);
    expect(restoreDatabaseFromFile(candidatePath)).toMatchObject({ success: false, error: 'simulated backup failure' });
    expectOriginal();
  });

  it('migrates a supported older schema on the staged copy and retains a safety snapshot', () => {
    const candidatePath = donor();
    const candidate = new Database(candidatePath);
    candidate.exec('ALTER TABLE activities DROP COLUMN z1_seconds');
    candidate.close();
    const result = restoreDatabaseFromFile(candidatePath);
    expect(result.success).toBe(true);
    expect(client.getDatabase().prepare('SELECT id, z1_seconds FROM activities').get())
      .toEqual({ id: 'replacement', z1_seconds: 0 });
    const safety = new Database(result.safetyBackupPath!, { readonly: true });
    try {
      expect(safety.prepare('SELECT id FROM activities').all()).toEqual([{ id: 'original' }]);
    } finally {
      safety.close();
    }
  });

  it('rolls back if installing the staged database fails', () => {
    const candidatePath = donor();
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (String(source).includes('.restore-stage-')) throw new Error('simulated rename failure');
      return rename(source, target);
    });
    expect(restoreDatabaseFromFile(candidatePath)).toMatchObject({ success: false, error: 'simulated rename failure' });
    expectOriginal();
  });

  it('rolls back if reopening the installed database fails', () => {
    const candidatePath = donor();
    const getDatabase = client.getDatabase;
    let failed = false;
    vi.spyOn(client, 'getDatabase').mockImplementation(dbPath => {
      if (dbPath === activePath && !failed) {
        failed = true;
        throw new Error('simulated reopen failure');
      }
      return getDatabase(dbPath);
    });
    expect(restoreDatabaseFromFile(candidatePath)).toMatchObject({ success: false, error: 'simulated reopen failure' });
    expectOriginal();
  });

  it('keeps the original run and all child rows when an overwrite insert fails', () => {
    const db = client.getDatabase();
    const csv = toCsv(getBenchmark('bench-threshold-3x10'));
    expect(importRunContent(db, csv, 'run.csv').status).toBe('imported');
    const tables = ['activities', 'activity_records', 'activity_splits', 'activity_intervals', 'physiological_thresholds', 'activity_coach_summaries'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    db.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON activity_records BEGIN SELECT RAISE(ABORT, 'simulated insert failure'); END");
    expect(importRunContent(db, csv, 'run.csv', { force: true })).toMatchObject({ status: 'error', error: 'simulated insert failure' });
    expect(tables.map(table => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
  });

  // The Google Drive integration was retired, but databases created before that
  // still hold OAuth rows on disk. Downloading a snapshot must never leak them.
  it('does not stream a snapshot when credential tables cannot be scrubbed', async () => {
    const db = client.getDatabase();
    db.exec("CREATE TABLE google_auth (client_secret TEXT); INSERT INTO google_auth VALUES ('private-client-secret')");
    db.exec("CREATE TRIGGER prevent_auth_delete BEFORE DELETE ON google_auth BEGIN SELECT RAISE(ABORT, 'cannot scrub'); END");

    const response = await request(app).get('/api/database/download');

    expect(response.status).toBe(500);
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.text).not.toContain('private-client-secret');
    expect(db.prepare('SELECT client_secret FROM google_auth').get())
      .toEqual({ client_secret: 'private-client-secret' });
  });

  it('strips legacy credential rows from downloaded snapshots', async () => {
    const db = client.getDatabase();
    db.exec("CREATE TABLE google_tokens (access_token TEXT); INSERT INTO google_tokens VALUES ('legacy-secret')");

    const response = await request(app).get('/api/database/download').responseType('blob');

    expect(response.status).toBe(200);
    const snapshot = new Database(response.body);
    try {
      expect(snapshot.prepare('SELECT * FROM google_tokens').all()).toEqual([]);
      expect(response.body.includes(Buffer.from('legacy-secret'))).toBe(false);
    } finally {
      snapshot.close();
    }
    // The live database must be left untouched.
    expect(db.prepare('SELECT access_token FROM google_tokens').get())
      .toEqual({ access_token: 'legacy-secret' });
  });

});
