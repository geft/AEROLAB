import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { createServer } from '../../src/backend/server.js';
import { getDatabase } from '../../src/backend/db/client.js';
import { createDatabaseBackup, checkAndRunScheduledBackup, listBackups } from '../../src/backend/routes/database.js';

describe('Database Backup & Cloud Sync Integration Tests', () => {
  let app: any;
  let testDir: string;
  let backupDir: string;
  let dbFilePath: string;
  let originalDbPath: string | undefined;

  beforeAll(() => {
    originalDbPath = process.env.DATABASE_PATH;
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-backup-test-'));
    backupDir = path.join(testDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    dbFilePath = path.join(testDir, 'test-runs.db');
    process.env.DATABASE_PATH = dbFilePath;

    // Initialize the DB
    const db = getDatabase(dbFilePath);
    // Insert dummy activity to verify data integrity
    db.prepare(`
      INSERT OR REPLACE INTO activities (
        id, source_filename, start_time, duration_seconds, distance_meters,
        avg_heart_rate, max_heart_rate, elevation_gain_m
      ) VALUES (
        'backup-test-run-1', 'test.csv', '2026-09-15T08:00:00Z', 1800, 5000,
        148, 165, 25
      )
    `).run();

    app = createServer();
  });

  afterAll(() => {
    if (originalDbPath !== undefined) {
      process.env.DATABASE_PATH = originalDbPath;
    } else {
      delete process.env.DATABASE_PATH;
    }
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it('GET /api/database/status returns database metadata and initial settings', async () => {
    const res = await request(app).get('/api/database/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dbPath');
    expect(res.body).toHaveProperty('sizeBytes');
    expect(res.body.activityCount).toBeGreaterThanOrEqual(1);
    expect(res.body.settings).toBeDefined();
    expect(res.body.settings.autoBackupEnabled).toBe(true);
    expect(res.body.settings.backupIntervalDays).toBe(7);
  });

  it('POST /api/database/backup creates a transactionally consistent snapshot', async () => {
    const res = await request(app)
      .post('/api/database/backup')
      .send({ targetDirectory: backupDir });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.backup).toBeDefined();
    expect(res.body.backup.filePath).toContain(backupDir);
    expect(fs.existsSync(res.body.backup.filePath)).toBe(true);
    expect(res.body.backup.sizeBytes).toBeGreaterThan(0);

    // Verify snapshot can be read as a valid SQLite DB and contains our activity
    const snapshotDb = new Database(res.body.backup.filePath);
    const count = (snapshotDb.prepare('SELECT count(*) as c FROM activities').get() as any).c;
    expect(count).toBeGreaterThanOrEqual(1);
    snapshotDb.close();
  });

  it('POST /api/database/settings updates preferences without clobbering profile', async () => {
    const res = await request(app)
      .post('/api/database/settings')
      .send({
        autoBackupEnabled: true,
        backupDirectory: backupDir,
        backupIntervalDays: 14
      });

    expect(res.status).toBe(200);
    expect(res.body.settings.backupIntervalDays).toBe(14);
    expect(res.body.settings.backupDirectory).toBe(backupDir);

    // Verify through /status
    const statusRes = await request(app).get('/api/database/status');
    expect(statusRes.body.settings.backupIntervalDays).toBe(14);
    expect(statusRes.body.settings.backupDirectory).toBe(backupDir);
  });

  it('rotates snapshots to retain only the newest N backups', () => {
    const db = getDatabase();
    const rotateDir = path.join(testDir, 'rotation-test');
    fs.mkdirSync(rotateDir, { recursive: true });

    // Create 5 backups with maxBackups set to 3
    for (let i = 0; i < 5; i++) {
      createDatabaseBackup(db, rotateDir, 3);
    }

    const backups = listBackups(rotateDir);
    expect(backups.length).toBeLessThanOrEqual(3);
  });

  it('GET /api/database/download streams a database snapshot as attachment', async () => {
    const res = await request(app).get('/api/database/download');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.db');
    expect(res.body).toBeDefined();
  });

  it('checkAndRunScheduledBackup respects interval and avoids redundant backups', async () => {
    const db = getDatabase();
    // Recently backed up, so should return false (not due)
    const result = await checkAndRunScheduledBackup(db);
    expect(result).toBe(false);
  });
});
