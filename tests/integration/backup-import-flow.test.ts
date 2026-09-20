import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { createServer } from '../../src/backend/server.js';
import { getDatabase, closeDatabase } from '../../src/backend/db/client.js';
import {
  checkAndRunScheduledBackup,
  listBackups,
  validateDatabaseSnapshot,
  saveBackupSettings
} from '../../src/backend/routes/database.js';
import { getBenchmark, toCsv } from '../fixtures/benchmark-runs.js';

describe('Comprehensive Backup & Ingestion / Import Integration Tests', () => {
  let app: any;
  let testDir: string;
  let backupDir: string;
  let dbFilePath: string;
  let originalDbPath: string | undefined;

  beforeAll(() => {
    originalDbPath = process.env.DATABASE_PATH;
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-backup-import-test-'));
    backupDir = path.join(testDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    dbFilePath = path.join(testDir, 'active-test.db');
    process.env.DATABASE_PATH = dbFilePath;

    // Seed database with initial activity
    const db = getDatabase(dbFilePath);
    db.prepare(`
      INSERT OR REPLACE INTO activities (
        id, source_filename, start_time, duration_seconds, distance_meters,
        avg_heart_rate, max_heart_rate, elevation_gain_m
      ) VALUES (
        'init-run-1', 'initial.csv', '2026-09-01T08:00:00Z', 2400, 6000,
        144, 160, 30
      )
    `).run();

    app = createServer();
  });

  afterAll(() => {
    closeDatabase();
    if (originalDbPath !== undefined) {
      process.env.DATABASE_PATH = originalDbPath;
    } else {
      delete process.env.DATABASE_PATH;
    }
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch { /* best-effort cleanup: safe to ignore */ }
  });

  describe('1. Backup Status, Settings & Rotation', () => {
    it('retrieves database status and updates auto-backup configuration', async () => {
      // Check status
      const statusRes = await request(app).get('/api/database/status');
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.activityCount).toBeGreaterThanOrEqual(1);
      expect(statusRes.body.settings.autoBackupEnabled).toBe(true);
      expect(statusRes.body.settings.backupIntervalDays).toBe(7);

      // Update settings
      const updateRes = await request(app)
        .post('/api/database/settings')
        .send({
          autoBackupEnabled: false,
          backupIntervalDays: 14,
          backupDirectory: backupDir
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.settings.autoBackupEnabled).toBe(false);
      expect(updateRes.body.settings.backupIntervalDays).toBe(14);
      expect(updateRes.body.settings.backupDirectory).toBe(backupDir);

      // Verify persistence in athlete profile preferences
      const db = getDatabase();
      const profileRow = db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'").get() as any;
      const parsed = JSON.parse(profileRow.preferences_json);
      expect(parsed.backup.backupIntervalDays).toBe(14);
      expect(parsed.backup.autoBackupEnabled).toBe(false);

      // Re-enable for subsequent tests
      await request(app)
        .post('/api/database/settings')
        .send({ autoBackupEnabled: true, backupIntervalDays: 7, backupDirectory: backupDir });
    });

    it('creates a local snapshot and enforces the 10-backup rotation retention policy', async () => {
      const rotateDir = path.join(testDir, 'rotation-test');
      fs.mkdirSync(rotateDir, { recursive: true });

      // Create 12 snapshots in rotation folder
      for (let i = 1; i <= 12; i++) {
        const res = await request(app)
          .post('/api/database/backup')
          .send({ targetDirectory: rotateDir });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        await new Promise((r) => setTimeout(r, 15));
      }

      const backups = listBackups(rotateDir);
      // Maximum 10 backups retained
      expect(backups.length).toBeLessThanOrEqual(10);
      expect(backups.length).toBe(10);
      // Every file should be a valid SQLite database
      for (const b of backups) {
        expect(fs.existsSync(b.filePath)).toBe(true);
        expect(b.sizeBytes).toBeGreaterThan(0);
      }
    });

    it('downloads database snapshot stream with valid SQLite header', async () => {
      const res = await request(app).get('/api/database/download');
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toMatch(/runs-backup-.*\.db/);
      expect(res.body).toBeInstanceOf(Buffer);

      // Verify first 16 bytes match SQLite magic header: "SQLite format 3\0"
      const header = (res.body as Buffer).subarray(0, 16).toString('utf8');
      expect(header).toBe('SQLite format 3\0');
    });

    it('checkAndRunScheduledBackup handles schedule calculation and triggers when due', async () => {
      const db = getDatabase();

      // Case A: Last backup was recent (within interval) -> should return false
      saveBackupSettings(db, { lastBackupAt: new Date().toISOString() });
      const notDueResult = await checkAndRunScheduledBackup(db);
      expect(notDueResult).toBe(false);

      // Case B: Last backup was 15 days ago -> should return true and execute backup
      const oldDate = new Date(Date.now() - 15 * 86400 * 1000).toISOString();
      saveBackupSettings(db, { lastBackupAt: oldDate });

      const dueResult = await checkAndRunScheduledBackup(db);
      expect(dueResult).toBe(true);

      // Verify lastBackupAt updated to now
      const profileRow = db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'").get() as any;
      const parsed = JSON.parse(profileRow.preferences_json);
      const updatedDate = new Date(parsed.backup.lastBackupAt);
      expect(Date.now() - updatedDate.getTime()).toBeLessThan(10000);
    });
  });

  describe('2. Database Restore Safety, Validation & Rollback', () => {
    it('creates an automated pre-restore safety snapshot before restoring', async () => {
      // Prepare a donor database
      const donorPath = path.join(testDir, 'safety-donor.db');
      const donorDb = getDatabase(donorPath);
      donorDb.prepare(`
        INSERT OR REPLACE INTO activities (
          id, source_filename, start_time, duration_seconds, distance_meters,
          avg_heart_rate, max_heart_rate, elevation_gain_m
        ) VALUES ('safety-run-100', 'safe.csv', '2026-09-17T08:00:00Z', 1500, 4000, 140, 155, 15)
      `).run();
      closeDatabase();
      getDatabase(dbFilePath);

      const donorBase64 = fs.readFileSync(donorPath).toString('base64');

      const res = await request(app)
        .post('/api/database/restore')
        .send({ base64: donorBase64 });

      expect(res.status).toBe(200);

      // Check default backup directory for pre-restore-safety-*.db files
      const backupFiles = fs.readdirSync(backupDir);
      const safetySnapshots = backupFiles.filter((f) => f.startsWith('pre-restore-safety-'));
      expect(safetySnapshots.length).toBeGreaterThanOrEqual(1);
    });

    it('rejects corrupt SQLite files and non-database files without corrupting active database', async () => {
      const dbBefore = getDatabase();
      const countBefore = (dbBefore.prepare('SELECT count(*) as c FROM activities').get() as any).c;

      // 1. Text payload
      const textRes = await request(app)
        .post('/api/database/restore')
        .send({ base64: Buffer.from('NOT A SQLITE FILE').toString('base64') });
      expect(textRes.status).toBe(422);
      expect(textRes.body.error).toContain('SQLite');

      // 2. Corrupted SQLite header
      const fakeHeader = Buffer.alloc(1024);
      fakeHeader.write('SQLite format 2\0');
      const headerRes = await request(app)
        .post('/api/database/restore')
        .send({ base64: fakeHeader.toString('base64') });
      expect(headerRes.status).toBe(422);

      // Verify active DB is intact
      const dbAfter = getDatabase();
      const countAfter = (dbAfter.prepare('SELECT count(*) as c FROM activities').get() as any).c;
      expect(countAfter).toBe(countBefore);
    });

    it('rejects a SQLite database missing required schema (e.g. missing activities table)', () => {
      const emptyDbPath = path.join(testDir, 'empty-schema.db');
      const emptyDb = new Database(emptyDbPath);
      emptyDb.exec('CREATE TABLE some_random_table (id INT, note TEXT);');
      emptyDb.close();

      const validation = validateDatabaseSnapshot(emptyDbPath);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('activities');
    });
  });

  describe('3. Ingestion & Workout Import Flow with Deduplication', () => {
    it('imports benchmark CSV workout and populates activities and metrics', async () => {
      const bench = getBenchmark('bench-easy-60');
      const csv = toCsv(bench);

      const res = await request(app)
        .post('/api/ingest/upload')
        .send({
          content: csv,
          filename: 'easy-run-upload.csv'
        });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.status).toBe('imported');
      expect(res.body.result.activityId).toBe('bench-easy-60');

      // Verify database record
      const db = getDatabase();
      const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get('bench-easy-60') as any;
      expect(activity).toBeDefined();
      expect(activity.duration_seconds).toBeGreaterThan(0);
      expect(activity.distance_meters).toBeGreaterThan(0);
      expect(activity.efficiency_factor).toBeGreaterThan(0);
    });

    it('detects duplicate workouts and skips them when force is false', async () => {
      const bench = getBenchmark('bench-easy-60');
      const csv = toCsv(bench);

      // Attempt to re-upload without force
      const res = await request(app)
        .post('/api/ingest/upload')
        .send({
          content: csv,
          filename: 'easy-run-upload.csv',
          force: false
        });

      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('skipped_duplicate');
      expect(res.body.result.activityId).toBe('bench-easy-60');
    });

    it('overwrites existing workout when force is true', async () => {
      const bench = getBenchmark('bench-easy-60');
      const csv = toCsv(bench);

      const res = await request(app)
        .post('/api/ingest/upload')
        .send({
          content: csv,
          filename: 'easy-run-upload.csv',
          force: true
        });

      expect(res.status).toBe(200);
      expect(res.body.result.status).toBe('imported');
      expect(res.body.result.activityId).toBe('bench-easy-60');
    });

    it('handles base64-encoded workout CSV payload cleanly', async () => {
      const bench = getBenchmark('bench-threshold-3x10');
      const csv = toCsv(bench);
      const base64 = Buffer.from(csv).toString('base64');

      const res = await request(app)
        .post('/api/ingest/upload')
        .send({
          content: base64,
          filename: 'threshold-run.csv'
        });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.status).toBe('imported');
      expect(res.body.result.activityId).toBe('bench-threshold-3x10');

      const db = getDatabase();
      const intervals = db.prepare('SELECT count(*) as c FROM activity_intervals WHERE activity_id = ?').get('bench-threshold-3x10') as any;
      expect(intervals.c).toBeGreaterThanOrEqual(1);
    });

    it('returns 400 Bad Request when content is missing', async () => {
      const res = await request(app)
        .post('/api/ingest/upload')
        .send({ filename: 'empty.csv' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing content');
    });

    it('returns 422 for unparseable or completely garbage workout data', async () => {
      const garbageCsv = 'not,a,valid\ngarmin,csv,header\n1,2,3';
      const res = await request(app)
        .post('/api/ingest/upload')
        .send({
          content: garbageCsv,
          filename: 'corrupt.csv'
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBeDefined();
    });
  });
});
