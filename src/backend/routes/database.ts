import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getDatabase, closeDatabase, openDatabase } from '../db/client.js';
import { getValidAccessToken, getGoogleAuthStatus } from '../auth/google-auth.js';
import {
  uploadBackupToGoogleDrive,
  listGoogleDriveBackups,
  downloadBackupFromGoogleDrive,
  GDriveFile
} from '../services/google-drive.js';
import { logger } from '../utils/logger.js';

export const databaseRouter = Router();

// A restore payload is base64-encoded, so the encoded string is roughly 1.37x
// the decoded database size. The scoped JSON parser in server.ts accepts up to
// 160 MB for this route, guaranteeing this guard (150 MB encoded) always runs
// and returns its specific message instead of a generic body-parser 413.
const MAX_ENCODED_RESTORE_BYTES = 150 * 1024 * 1024;

export interface BackupSettings {
  autoBackupEnabled: boolean;
  backupDirectory: string;
  backupIntervalDays: number;
  lastBackupAt: string | null;
  cloudSyncEnabled?: boolean;
  lastCloudBackupAt?: string | null;
}

export function getDefaultBackupDir(db: Database.Database): string {
  const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'runs.db');
  if (dbPath === ':memory:') {
    return path.join(os.tmpdir(), 'aerolab-backups');
  }
  const dir = path.dirname(dbPath);
  return path.join(dir, 'backups');
}

export function getBackupSettings(db: Database.Database): BackupSettings {
  const defaultDir = getDefaultBackupDir(db);
  try {
    const row = db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'").get() as any;
    if (row && row.preferences_json) {
      const prefs = JSON.parse(row.preferences_json);
      if (prefs.backup) {
        return {
          autoBackupEnabled: Boolean(prefs.backup.autoBackupEnabled),
          backupDirectory: prefs.backup.backupDirectory || defaultDir,
          backupIntervalDays: prefs.backup.backupIntervalDays || 7,
          lastBackupAt: prefs.backup.lastBackupAt || null,
          cloudSyncEnabled: Boolean(prefs.backup.cloudSyncEnabled),
          lastCloudBackupAt: prefs.backup.lastCloudBackupAt || null
        };
      }
    }
  } catch {}

  return {
    autoBackupEnabled: true,
    backupDirectory: defaultDir,
    backupIntervalDays: 7,
    lastBackupAt: null,
    cloudSyncEnabled: false,
    lastCloudBackupAt: null
  };
}

export function saveBackupSettings(db: Database.Database, newSettings: Partial<BackupSettings>): BackupSettings {
  const current = getBackupSettings(db);
  const updated: BackupSettings = {
    ...current,
    ...newSettings
  };

  try {
    const row = db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'").get() as any;
    let prefs: any = {};
    if (row && row.preferences_json) {
      prefs = JSON.parse(row.preferences_json);
    }
    prefs.backup = updated;
    db.prepare("UPDATE athlete_profile SET preferences_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'primary'").run(JSON.stringify(prefs));
  } catch {}

  return updated;
}

export function listBackups(directory: string): Array<{ filename: string; filePath: string; sizeBytes: number; createdAt: string }> {
  try {
    if (!fs.existsSync(directory)) return [];
    const files = fs.readdirSync(directory);
    return files
      .filter(f => f.startsWith('runs-') && f.endsWith('.db'))
      .map(f => {
        const filePath = path.join(directory, f);
        const stats = fs.statSync(filePath);
        return {
          filename: f,
          filePath,
          sizeBytes: stats.size,
          createdAt: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function isSafeBackupDirectory(dirPath: string): boolean {
  if (!dirPath || typeof dirPath !== 'string') return false;
  if (/[\0\x00-\x1f]/.test(dirPath)) return false;
  if (dirPath.includes('..')) return false;

  const normalized = path.normalize(dirPath);
  if (!path.isAbsolute(normalized)) return false;

  const lower = normalized.toLowerCase().replace(/\\/g, '/');
  const forbiddenRoots = [
    'c:/windows', 'c:/program files', 'c:/program files (x86)',
    '/etc', '/bin', '/sbin', '/usr', '/var', '/system', '/library'
  ];
  if (forbiddenRoots.some(f => lower === f || lower.startsWith(f + '/'))) {
    return false;
  }

  return true;
}

export function createDatabaseBackup(db: Database.Database, targetDirectory?: string, maxBackups: number = 10): { filePath: string; filename: string; sizeBytes: number; createdAt: string } {
  const settings = getBackupSettings(db);
  const rawDir = targetDirectory ? String(targetDirectory).trim() : '';
  let backupDir: string;
  if (rawDir) {
    if (!isSafeBackupDirectory(rawDir)) {
      throw new Error('Invalid or unauthorized backup directory path.');
    }
    backupDir = path.resolve(rawDir);
  } else {
    backupDir = settings.backupDirectory || getDefaultBackupDir(db);
  }

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  let filename = `runs-backup-${stamp}.db`;
  let filePath = path.join(backupDir, filename);

  if (fs.existsSync(filePath)) {
    filename = `runs-backup-${stamp}-${Math.random().toString(36).slice(2, 7)}.db`;
    filePath = path.join(backupDir, filename);
  }

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }

  // Online, transactional SQLite snapshot without interrupting active readers/writers
  const normalized = filePath.replace(/\\/g, '/').replace(/'/g, "''");
  db.prepare(`VACUUM INTO '${normalized}'`).run();

  const stats = fs.statSync(filePath);
  const createdAt = now.toISOString();

  // Save last backup timestamp
  saveBackupSettings(db, { lastBackupAt: createdAt });

  // Rotate old backups in this directory (keep newest N)
  try {
    const existing = listBackups(backupDir);
    if (existing.length > maxBackups) {
      const toDelete = existing.slice(maxBackups);
      for (const old of toDelete) {
        try {
          fs.unlinkSync(old.filePath);
        } catch {}
      }
    }
  } catch {}

  return {
    filePath,
    filename,
    sizeBytes: stats.size,
    createdAt
  };
}

export function validateDatabaseSnapshot(filePath: string): { valid: boolean; activityCount: number; error?: string } {
  if (!fs.existsSync(filePath)) {
    return { valid: false, activityCount: 0, error: 'File does not exist' };
  }

  try {
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    if (buffer.toString('utf8', 0, 15) !== 'SQLite format 3') {
      return { valid: false, activityCount: 0, error: 'File is not a valid SQLite database format' };
    }
  } catch (err: any) {
    return { valid: false, activityCount: 0, error: `Cannot read file header: ${err.message}` };
  }

  let testDb: Database.Database | null = null;
  try {
    testDb = new Database(filePath, { readonly: true, fileMustExist: true });
    const check = testDb.pragma('integrity_check') as any[];
    if (!check || check[0]?.integrity_check !== 'ok') {
      return { valid: false, activityCount: 0, error: 'Database failed SQLite integrity check' };
    }

    const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map(t => t.name));
    if (!tableNames.has('activities')) {
      return { valid: false, activityCount: 0, error: 'Database does not contain required "activities" table' };
    }

    const columns = new Set((testDb.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(c => c.name));
    if (!['id', 'start_time', 'run_type', 'distance_meters', 'duration_seconds'].every(c => columns.has(c))) {
      return { valid: false, activityCount: 0, error: 'Incompatible activities schema' };
    }

    const count = (testDb.prepare('SELECT count(*) as c FROM activities').get() as any)?.c || 0;
    return { valid: true, activityCount: count };
  } catch (err: any) {
    return { valid: false, activityCount: 0, error: err.message || 'Corrupt database file' };
  } finally {
    if (testDb) {
      try { testDb.close(); } catch {}
    }
  }
}

export function restoreDatabaseFromFile(candidatePath: string): { success: boolean; activityCount: number; safetyBackupPath?: string; error?: string } {
  const validation = validateDatabaseSnapshot(candidatePath);
  if (!validation.valid) {
    return { success: false, activityCount: 0, error: validation.error };
  }

  const activeDbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'runs.db');

  if (activeDbPath === ':memory:') {
    return { success: false, activityCount: 0, error: 'Restore requires a file-backed database' };
  }

  const targetDir = path.dirname(activeDbPath);
  fs.mkdirSync(targetDir, { recursive: true });
  const stagePath = path.join(targetDir, `.restore-stage-${randomUUID()}.db`);
  const rollbackPath = path.join(targetDir, `.restore-rollback-${randomUUID()}.db`);
  let safetyBackupPath: string | undefined;
  let movedOriginal = false;
  let installedCandidate = false;
  try {
    fs.copyFileSync(candidatePath, stagePath);
    const stagedDb = openDatabase(stagePath, true);
    stagedDb.close(); // Checkpoint the staged WAL before moving its main file.

    const activeDb = getDatabase();
    const backupDir = getDefaultBackupDir(activeDb);
    fs.mkdirSync(backupDir, { recursive: true });
    safetyBackupPath = path.join(backupDir, `pre-restore-safety-${randomUUID()}.db`);
    // A failed safety backup must abort the restore before changing the active database.
    activeDb.prepare(`VACUUM INTO '${safetyBackupPath.replace(/\\/g, '/').replace(/'/g, "''")}'`).run();
    const checkpoint = activeDb.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
    if (checkpoint.some(row => row.busy !== 0)) throw new Error('Database is busy; close other connections before restoring');
    closeDatabase();

    fs.renameSync(activeDbPath, rollbackPath);
    movedOriginal = true;
    fs.renameSync(stagePath, activeDbPath);
    installedCandidate = true;
    const newDb = getDatabase(activeDbPath);
    const newCount = (newDb.prepare('SELECT count(*) as c FROM activities').get() as any).c;
    // Keep the safety snapshot; the old main file is no longer needed.
    try { fs.unlinkSync(rollbackPath); } catch {}
    return { success: true, activityCount: newCount, safetyBackupPath };
  } catch (err: any) {
    if (movedOriginal) {
      closeDatabase();
      if (installedCandidate) {
        for (const suffix of ['', '-wal', '-shm']) {
          if (fs.existsSync(activeDbPath + suffix)) fs.unlinkSync(activeDbPath + suffix);
        }
      }
      fs.renameSync(rollbackPath, activeDbPath);
      getDatabase(activeDbPath);
    }
    return { success: false, activityCount: 0, safetyBackupPath, error: err.message || 'Restore failed' };
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { if (fs.existsSync(stagePath + suffix)) fs.unlinkSync(stagePath + suffix); } catch {}
    }
  }
}

export async function checkAndRunScheduledBackup(db: Database.Database): Promise<boolean> {
  try {
    const settings = getBackupSettings(db);
    if (!settings.autoBackupEnabled) return false;

    if (settings.lastBackupAt) {
      const last = new Date(settings.lastBackupAt).getTime();
      const now = Date.now();
      const elapsedDays = (now - last) / (1000 * 60 * 60 * 24);
      if (elapsedDays < settings.backupIntervalDays) {
        return false;
      }
    }

    const backup = createDatabaseBackup(db, settings.backupDirectory);

    // Also sync to Google Drive if connected and enabled
    if (settings.cloudSyncEnabled) {
      try {
        const token = await getValidAccessToken(db);
        if (token) {
          await uploadBackupToGoogleDrive(token, backup.filePath, backup.filename);
          saveBackupSettings(db, { lastCloudBackupAt: new Date().toISOString() });
        }
      } catch (cloudErr) {
        logger.warn('Database', 'Scheduled backup cloud sync failed', { error: String(cloudErr) });
      }
    }

    return true;
  } catch {
    return false;
  }
}

// GET /api/database/status
databaseRouter.get('/status', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const dbPath = process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'runs.db');
    let sizeBytes = 0;
    if (fs.existsSync(dbPath)) {
      sizeBytes = fs.statSync(dbPath).size;
    }

    const activityCount = (db.prepare('SELECT count(*) as c FROM activities').get() as any)?.c || 0;
    const settings = getBackupSettings(db);
    const backups = listBackups(settings.backupDirectory);
    const googleStatus = getGoogleAuthStatus(db);

    const backupsWithMb = backups.map(b => ({
      ...b,
      sizeMb: Number((b.sizeBytes / (1024 * 1024)).toFixed(2))
    }));

    res.json({
      dbPath,
      sizeBytes,
      sizeMb: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
      activityCount,
      settings,
      googleStatus,
      snapshots: backupsWithMb,
      recentBackups: backupsWithMb.slice(0, 5)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve database status' });
  }
});

// POST /api/database/backup
databaseRouter.post('/backup', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { targetDirectory } = req.body || {};
    const backup = createDatabaseBackup(db, targetDirectory);
    res.json({
      status: 'ok',
      backup
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate database backup' });
  }
});

// POST /api/database/settings
databaseRouter.post('/settings', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { autoBackupEnabled, backupDirectory, backupIntervalDays, cloudSyncEnabled } = req.body || {};

    if (backupDirectory && !isSafeBackupDirectory(String(backupDirectory).trim())) {
      return res.status(400).json({ error: 'Invalid or unsafe backup directory path.' });
    }

    const updated = saveBackupSettings(db, {
      ...(autoBackupEnabled !== undefined ? { autoBackupEnabled: Boolean(autoBackupEnabled) } : {}),
      ...(backupDirectory ? { backupDirectory: String(backupDirectory).trim() } : {}),
      ...(backupIntervalDays ? { backupIntervalDays: Number(backupIntervalDays) } : {}),
      ...(cloudSyncEnabled !== undefined ? { cloudSyncEnabled: Boolean(cloudSyncEnabled) } : {})
    });
    res.json({
      status: 'ok',
      settings: updated
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update backup settings' });
  }
});

// GET /api/database/download
databaseRouter.get('/download', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const tmpDir = os.tmpdir();
    const dateStr = new Date().toISOString().slice(0, 10);
    const tmpPath = path.join(tmpDir, `runs-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`);
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }

    // Create a safe snapshot
    const normalized = tmpPath.replace(/\\/g, '/').replace(/'/g, "''");
    db.prepare(`VACUUM INTO '${normalized}'`).run();

    // Fail closed: never stream a snapshot if credential sanitization fails.
    try {
      const exportDb = new Database(tmpPath);
      try {
        exportDb.pragma('secure_delete = ON');
        for (const table of ['google_auth', 'google_tokens']) {
          if (exportDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
            exportDb.prepare(`DELETE FROM ${table}`).run();
          }
        }
        exportDb.exec('VACUUM'); // Remove deleted secrets from free pages as well.
      } finally {
        exportDb.close();
      }
    } catch (cleanErr) {
      try { fs.unlinkSync(tmpPath); } catch {}
      throw cleanErr;
    }

    res.download(tmpPath, `runs-backup-${dateStr}.db`, (err) => {
      // Clean up the temporary snapshot file after download completes or errors
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {}
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to download database snapshot' });
  }
});

// POST /api/database/backup-gdrive - create snapshot and upload directly to Google Drive
databaseRouter.post('/backup-gdrive', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const token = await getValidAccessToken(db);
    if (!token) {
      return res.status(401).json({ error: 'Google account is not connected or token expired. Please sign in with Google.' });
    }

    // Create local temporary snapshot
    const tmpDir = os.tmpdir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `runs-backup-${stamp}.db`;
    const tmpPath = path.join(tmpDir, filename);

    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }

    const normalized = tmpPath.replace(/\\/g, '/').replace(/'/g, "''");
    db.prepare(`VACUUM INTO '${normalized}'`).run();

    try {
      const gdriveFile = await uploadBackupToGoogleDrive(token, tmpPath, filename);
      saveBackupSettings(db, { lastCloudBackupAt: gdriveFile.createdTime });

      res.json({
        status: 'ok',
        file: gdriveFile
      });
    } finally {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    }
  } catch (err: any) {
    logger.error('Database', 'Google Drive Backup Error', err);
    res.status(500).json({ error: err.message || 'Failed to backup to Google Drive' });
  }
});

// GET /api/database/gdrive-backups - list backups in Google Drive
databaseRouter.get('/gdrive-backups', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const token = await getValidAccessToken(db);
    if (!token) {
      return res.status(401).json({ error: 'Google account is not connected' });
    }

    const backups = await listGoogleDriveBackups(token);
    res.json({ backups });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch Google Drive backups' });
  }
});

// POST /api/database/restore - restore active database from uploaded .db file or base64
databaseRouter.post('/restore', (req: Request, res: Response) => {
  try {
    const { content, base64 } = req.body || {};
    const rawData = content || base64;
    if (!rawData) {
      return res.status(400).json({ error: 'Missing database content. Please provide base64 database data.' });
    }

    // Protect against unbounded memory allocation (max ~100 MB decoded database)
    if (typeof rawData !== 'string' || rawData.length > MAX_ENCODED_RESTORE_BYTES) {
      return res.status(413).json({ error: 'Database payload exceeds maximum permitted size (100 MB database / 150 MB encoded).' });
    }

    const cleanBase64 = rawData.includes(';base64,') ? rawData.split(';base64,')[1] : rawData;
    const fileBuffer = Buffer.from(cleanBase64, 'base64');

    const tmpDir = os.tmpdir();
    const tmpCandidatePath = path.join(tmpDir, `restore-candidate-${Date.now()}.db`);
    fs.writeFileSync(tmpCandidatePath, fileBuffer);

    try {
      const result = restoreDatabaseFromFile(tmpCandidatePath);
      if (!result.success) {
        return res.status(422).json({ error: result.error || 'Failed to restore database' });
      }

      res.json({
        status: 'ok',
        activityCount: result.activityCount,
        safetyBackupPath: result.safetyBackupPath
      });
    } finally {
      try { if (fs.existsSync(tmpCandidatePath)) fs.unlinkSync(tmpCandidatePath); } catch {}
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to restore database' });
  }
});

// POST /api/database/restore-gdrive - download backup from Google Drive and restore
databaseRouter.post('/restore-gdrive', async (req: Request, res: Response) => {
  try {
    const { fileId } = req.body || {};
    if (!fileId) {
      return res.status(400).json({ error: 'Missing fileId parameter' });
    }

    const db = getDatabase();
    const token = await getValidAccessToken(db);
    if (!token) {
      return res.status(401).json({ error: 'Google account is not connected' });
    }

    const buffer = await downloadBackupFromGoogleDrive(token, fileId);
    const tmpDir = os.tmpdir();
    const tmpCandidatePath = path.join(tmpDir, `gdrive-restore-${Date.now()}.db`);
    fs.writeFileSync(tmpCandidatePath, buffer);

    try {
      const result = restoreDatabaseFromFile(tmpCandidatePath);
      if (!result.success) {
        return res.status(422).json({ error: result.error || 'Failed to restore database from Google Drive' });
      }

      res.json({
        status: 'ok',
        activityCount: result.activityCount,
        safetyBackupPath: result.safetyBackupPath
      });
    } finally {
      try { if (fs.existsSync(tmpCandidatePath)) fs.unlinkSync(tmpCandidatePath); } catch {}
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to restore from Google Drive' });
  }
});
