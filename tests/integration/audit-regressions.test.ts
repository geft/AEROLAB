import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer, listenOnLoopback } from '../../src/backend/server.js';
import * as client from '../../src/backend/db/client.js';
import { restoreDatabaseFromFile, validateDatabaseSnapshot } from '../../src/backend/routes/database.js';
import { saveGoogleCredentials } from '../../src/backend/auth/google-auth.js';
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
    client.getDatabase(activePath).prepare("INSERT INTO activities (id, start_time, notes) VALUES ('original', '2026-01-01', 'keep me')").run();
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

  async function beginLogin() {
    saveGoogleCredentials(client.getDatabase(), 'test-client', 'test-secret');
    const response = await request(app).get('/api/auth/google/url').set('Referer', 'http://localhost:5173/profile')
      .query({ origin: 'http://localhost:3001', state: 'attacker-chosen' });
    expect(response.status).toBe(200);
    const state = new URL(response.body.url).searchParams.get('state')!;
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    return { state, cookie, response };
  }

  function donor() {
    const donorPath = path.join(directory, 'donor.db');
    const db = client.openDatabase(donorPath, true);
    db.prepare("INSERT INTO activities (id, start_time) VALUES ('replacement', '2026-02-01')").run();
    db.close();
    return donorPath;
  }

  function expectOriginal() {
    expect(client.getDatabase().prepare('SELECT id, notes FROM activities').all())
      .toEqual([{ id: 'original', notes: 'keep me' }]);
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

  it('issues unique server-generated states with an HttpOnly browser binding', async () => {
    const first = await beginLogin();
    const second = await beginLogin();
    expect(first.state).not.toBe('attacker-chosen');
    expect(second.state).not.toBe(first.state);
    expect(first.response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(first.response.headers['set-cookie'][0]).toContain('SameSite=Lax');
  });

  it('rejects missing, unknown, unbound and expired state before exchanging tokens', async () => {
    const login = await beginLogin();
    for (const state of [undefined, 'unknown', login.state]) {
      const response = await request(app).get('/api/auth/google/callback').query({ code: 'test-code', state });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('OAuth state');
    }
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000);
    const expired = await request(app).get('/api/auth/google/callback').set('Cookie', login.cookie)
      .query({ code: 'test-code', state: login.state });
    expect(expired.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('escapes callback error HTML and consumes the state even when cancelled', async () => {
    const login = await beginLogin();
    const response = await request(app).get('/api/auth/google/callback').set('Cookie', login.cookie)
      .query({ state: login.state, error: '<script>window.injected=1</script>' });
    expect(response.status).toBe(400);
    expect(response.text).toContain('&lt;script&gt;');
    expect(response.text).not.toContain('<script>window.injected');
    const replay = await request(app).get('/api/auth/google/callback').set('Cookie', login.cookie)
      .query({ state: login.state, code: 'replay' });
    expect(replay.body.error).toContain('OAuth state');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('escapes token exchange failures', async () => {
    const login = await beginLogin();
    vi.mocked(fetch).mockResolvedValue(new Response('<script>bad()</script>', { status: 400 }));
    const response = await request(app).get('/api/auth/google/callback').set('Cookie', login.cookie)
      .query({ state: login.state, code: 'valid-code' });
    expect(response.status).toBe(400);
    expect(response.text).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(response.text).not.toContain('<script>bad()');
  });

  it('does not stream a backup when credentials cannot be scrubbed', async () => {
    saveGoogleCredentials(client.getDatabase(), 'test-client', 'private-client-secret');
    client.getDatabase().exec("CREATE TRIGGER prevent_auth_delete BEFORE DELETE ON google_auth BEGIN SELECT RAISE(ABORT, 'cannot scrub'); END");
    const response = await request(app).get('/api/database/download');
    expect(response.status).toBe(500);
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.text).not.toContain('private-client-secret');
    expect(client.getDatabase().prepare('SELECT client_secret FROM google_auth').get())
      .toEqual({ client_secret: 'private-client-secret' });
  });

  it('also removes legacy token rows from downloaded snapshots', async () => {
    client.getDatabase().exec("CREATE TABLE google_tokens (access_token TEXT); INSERT INTO google_tokens VALUES ('legacy-secret')");
    const response = await request(app).get('/api/database/download').responseType('blob');
    expect(response.status).toBe(200);
    const snapshot = new Database(response.body);
    try {
      expect(snapshot.prepare('SELECT * FROM google_tokens').all()).toEqual([]);
      expect(response.body.includes(Buffer.from('legacy-secret'))).toBe(false);
    } finally {
      snapshot.close();
    }
    expect(client.getDatabase().prepare('SELECT access_token FROM google_tokens').get())
      .toEqual({ access_token: 'legacy-secret' });
  });

  it('accepts a bound state once and safely renders profile data in HTML and JavaScript', async () => {
    const login = await beginLogin();
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ access_token: 'fake-token', refresh_token: 'fake-refresh' }))
      .mockResolvedValueOnce(Response.json({ email: '</script><script>bad()</script>' }));
    const response = await request(app).get('/api/auth/google/callback').set('Cookie', login.cookie)
      .query({ state: login.state, code: 'valid-code' });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain('</script><script>bad()');
    expect(response.text).toContain('\\u003c/script>');
    expect(response.text).toContain('"http://localhost:5173"');
    expect(String(vi.mocked(fetch).mock.calls[0][1]?.body)).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fapi%2Fauth%2Fgoogle%2Fcallback');
    expect(client.getDatabase().prepare('SELECT access_token FROM google_auth').get()).toEqual({ access_token: 'fake-token' });
    const replay = await request(app).get('/api/auth/google/callback').set('Cookie', login.cookie)
      .query({ state: login.state, code: 'valid-code' });
    expect(replay.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(2);
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
      expect(safety.prepare('SELECT id, notes FROM activities').all()).toEqual([{ id: 'original', notes: 'keep me' }]);
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
});
