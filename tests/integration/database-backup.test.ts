import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { createServer } from '../../src/backend/server.js';
import { getDatabase } from '../../src/backend/db/client.js';
import {
  createAutomaticBackupIfDue,
  createDatabaseBackup,
  getBackupSettings,
  getDefaultBackupDir,
  handleSelectFolder,
  isSafeBackupDirectory,
  listBackups,
  pruneBackups,
  saveBackupSettings
} from '../../src/backend/routes/database.js';

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
    } catch { /* best-effort cleanup: safe to ignore */ }
  });

  it('GET /api/database/status returns database metadata and initial settings', async () => {
    const res = await request(app).get('/api/database/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dbPath');
    expect(res.body).toHaveProperty('sizeBytes');
    expect(res.body.activityCount).toBeGreaterThanOrEqual(1);
    expect(res.body.settings).toBeDefined();
    expect(res.body.settings.backupDirectory).toBe(getDefaultBackupDir(getDatabase()));
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
      .send({ backupDirectory: backupDir });

    expect(res.status).toBe(200);
    expect(res.body.settings.backupDirectory).toBe(backupDir);

    // Verify through /status
    const statusRes = await request(app).get('/api/database/status');
    expect(statusRes.body.settings.backupDirectory).toBe(backupDir);
  });

  it('rotates snapshots to retain only the newest N backups', () => {
    const db = getDatabase();
    const rotateDir = path.join(testDir, 'rotation-test');
    fs.mkdirSync(rotateDir, { recursive: true });

    // Create 5 backups; only the newest 3 should remain.
    for (let i = 0; i < 5; i++) {
      createDatabaseBackup(db, rotateDir);
    }

    const backups = listBackups(rotateDir);
    expect(backups.length).toBeLessThanOrEqual(3);
  });

  it('creates an automatic snapshot when none exists in the configured folder', () => {
    const db = getDatabase();
    const automaticDir = path.join(testDir, 'automatic-empty');
    const originalSettings = getBackupSettings(db);
    const now = new Date();

    try {
      saveBackupSettings(db, { backupDirectory: automaticDir });

      const backup = createAutomaticBackupIfDue(db, now);

      expect(backup).not.toBeNull();
      expect(backup?.filePath).toContain(automaticDir);
      expect(listBackups(automaticDir)).toHaveLength(1);
      expect(createAutomaticBackupIfDue(db, now)).toBeNull();
    } finally {
      saveBackupSettings(db, originalSettings);
    }
  });

  it('waits until seven days have passed and then adds to the configured rolling snapshots', () => {
    const db = getDatabase();
    const automaticDir = path.join(testDir, 'automatic-aged');
    const originalSettings = getBackupSettings(db);
    const now = new Date();

    try {
      saveBackupSettings(db, { backupDirectory: automaticDir });
      const existing = [
        createDatabaseBackup(db, automaticDir),
        createDatabaseBackup(db, automaticDir),
        createDatabaseBackup(db, automaticDir)
      ];
      const recentTime = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      for (const backup of existing) fs.utimesSync(backup.filePath, recentTime, recentTime);

      expect(createAutomaticBackupIfDue(db, now)).toBeNull();
      expect(listBackups(automaticDir)).toHaveLength(3);

      const oldTime = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      for (const backup of existing) fs.utimesSync(backup.filePath, oldTime, oldTime);

      const automatic = createAutomaticBackupIfDue(db, now);

      expect(automatic).not.toBeNull();
      expect(automatic?.filePath).toContain(automaticDir);
      expect(listBackups(automaticDir)).toHaveLength(3);
      expect(listBackups(automaticDir).some(backup => backup.filePath === automatic?.filePath)).toBe(true);
    } finally {
      saveBackupSettings(db, originalSettings);
    }
  });

  it('cleans excess rolling and migration snapshots at startup even when no backup is due', () => {
    const db = getDatabase();
    const directory = path.join(testDir, 'startup-retention');
    fs.mkdirSync(directory);
    const originalSettings = getBackupSettings(db);
    try {
      saveBackupSettings(db, { backupDirectory: directory });
      const now = new Date();
      for (let i = 0; i < 6; i++) {
        for (const name of [`runs-legacy-${i}.db`, `pre-migration-${i}.db`]) {
          const file = path.join(directory, name);
          fs.writeFileSync(file, 'snapshot');
          const time = new Date(now.getTime() - i * 1000);
          fs.utimesSync(file, time, time);
        }
      }
      expect(createAutomaticBackupIfDue(db, now)).toBeNull();
      expect(listBackups(directory)).toHaveLength(3);
      expect(fs.readdirSync(directory).filter(name => name.startsWith('pre-migration-'))).toHaveLength(3);
    } finally {
      saveBackupSettings(db, originalSettings);
    }
  });

  it('handles folder selection for valid, cancelled, and invalid choices', async () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const response = { json, status } as any;

    await handleSelectFolder({} as any, response, async () => backupDir);
    expect(json).toHaveBeenCalledWith({ folder: path.resolve(backupDir) });

    json.mockClear();
    await handleSelectFolder({} as any, response, async () => null);
    expect(json).toHaveBeenCalledWith({ folder: null, cancelled: true });

    status.mockClear();
    await handleSelectFolder({} as any, response, async () => path.join(testDir, 'missing-folder'));
    expect(status).toHaveBeenCalledWith(400);

    status.mockClear();
    await handleSelectFolder({} as any, response, async () => { throw new Error('picker failed'); });
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'picker failed' });
  });

  it('validates backup paths and preserves unrelated profile preferences', () => {
    const db = getDatabase();
    const originalPreferences = (db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'").get() as any).preferences_json;
    expect(getDefaultBackupDir(db)).toBe(path.join(testDir, 'backups'));
    expect(isSafeBackupDirectory(backupDir)).toBe(true);
    expect(isSafeBackupDirectory('relative/backups')).toBe(false);
    expect(isSafeBackupDirectory(`${testDir}\\..\\unsafe`)).toBe(false);
    expect(isSafeBackupDirectory(`${backupDir}\u0001unsafe`)).toBe(false);

    try {
      db.prepare("UPDATE athlete_profile SET preferences_json = ? WHERE id = 'primary'")
        .run(JSON.stringify({ theme: 'dark', backup: { autoBackupEnabled: true, backupDirectory: backupDir, backupIntervalDays: 7 } }));
      const updated = saveBackupSettings(db, { backupDirectory: backupDir });

      expect(updated).toEqual({ backupDirectory: backupDir });
      expect(getBackupSettings(db)).toEqual(updated);
      const preferences = JSON.parse((db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'").get() as any).preferences_json);
      expect(preferences.theme).toBe('dark');
      expect(preferences.backup).toEqual({ backupDirectory: backupDir });
    } finally {
      db.prepare("UPDATE athlete_profile SET preferences_json = ? WHERE id = 'primary'").run(originalPreferences);
    }
  });

  it('falls back to defaults when stored backup preferences are malformed', () => {
    const db = getDatabase();
    const originalPreferences = (db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'").get() as any).preferences_json;
    try {
      db.prepare("UPDATE athlete_profile SET preferences_json = ? WHERE id = 'primary'").run('{broken json');
      const settings = getBackupSettings(db);

      expect(settings.backupDirectory).toBe(getDefaultBackupDir(db));
    } finally {
      db.prepare("UPDATE athlete_profile SET preferences_json = ? WHERE id = 'primary'").run(originalPreferences);
    }
  });

  it('prunes older snapshots beyond the three-file rotation', () => {
    const db = getDatabase();
    const legacyDir = path.join(testDir, 'legacy-rotation-test');
    fs.mkdirSync(legacyDir, { recursive: true });

    for (let i = 0; i < 7; i++) {
      createDatabaseBackup(db, legacyDir);
    }

    expect(listBackups(legacyDir)).toHaveLength(3);
    expect(pruneBackups(legacyDir)).toHaveLength(3);
  });

  it('does not delete snapshots when reading database status', async () => {
    const db = getDatabase();
    const statusDir = path.join(testDir, 'status-read-test');
    fs.mkdirSync(statusDir, { recursive: true });
    for (let i = 0; i < 7; i++) createDatabaseBackup(db, statusDir);
    await request(app).post('/api/database/settings').send({ backupDirectory: statusDir });

    const status = await request(app).get('/api/database/status');
    expect(status.status).toBe(200);
    expect(status.body.snapshots).toHaveLength(3);
    expect(listBackups(statusDir)).toHaveLength(3);
  });

  it('deletes only a selected snapshot from the configured backup directory', async () => {
    saveBackupSettings(getDatabase(), { backupDirectory: backupDir });
    const backup = createDatabaseBackup(getDatabase(), backupDir);
    const result = await request(app).post('/api/database/snapshots/delete').send({ filename: backup.filename });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: 'ok', filename: backup.filename });
    expect(fs.existsSync(backup.filePath)).toBe(false);

    const invalid = await request(app).post('/api/database/snapshots/delete').send({ filename: '..\\test.db' });
    expect(invalid.status).toBe(400);
  });

  it('GET /api/database/download streams a database snapshot as attachment', async () => {
    const res = await request(app).get('/api/database/download');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.db');
    expect(res.body).toBeDefined();
  });
});
