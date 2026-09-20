import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getDatabase, closeDatabase, openDatabase } from '../db/client.js';
import { logger } from '../utils/logger.js';

export const databaseRouter = Router();

// A restore payload is base64-encoded, so the encoded string is roughly 1.37x
// the decoded database size. The scoped JSON parser in server.ts accepts up to
// 160 MB for this route, guaranteeing this guard (150 MB encoded) always runs
// and returns its specific message instead of a generic body-parser 413.
const MAX_ENCODED_RESTORE_BYTES = 150 * 1024 * 1024;

/**
 * Ceiling for streamed binary restores.
 *
 * The legacy path sends the database as base64 inside JSON, which inflates the
 * payload by ~33% and needs the whole thing in memory twice (JSON string +
 * decoded buffer). The binary path pipes the request body straight to disk, so
 * the practical limit is disk space rather than RAM. Override with
 * MAX_RESTORE_BYTES if you really need a larger snapshot.
 */
const MAX_BINARY_RESTORE_BYTES = Number(process.env.MAX_RESTORE_BYTES) || 2 * 1024 * 1024 * 1024;

/** Every SQLite database file starts with this 16-byte header. */
const SQLITE_MAGIC = 'SQLite format 3\0';

/** Stream a request body to disk, aborting as soon as it exceeds maxBytes. */
function saveStreamToFile(
  req: Request,
  targetPath: string,
  maxBytes: number
): Promise<{ ok: true } | { ok: false; tooLarge: boolean; error?: string }> {
  return new Promise(resolve => {
    const out = fs.createWriteStream(targetPath);
    let received = 0;
    let settled = false;

    const settle = (result: { ok: true } | { ok: false; tooLarge: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        req.destroy();
        out.destroy();
        settle({ ok: false, tooLarge: true });
      }
    });
    req.on('error', (err: Error) => {
      out.destroy();
      settle({ ok: false, tooLarge: false, error: err.message });
    });
    out.on('error', (err: Error) => settle({ ok: false, tooLarge: false, error: err.message }));
    out.on('finish', () => settle({ ok: true }));

    req.pipe(out);
  });
}

/** Confirm the staged file really is a SQLite database before touching the live one. */
function hasSqliteHeader(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(SQLITE_MAGIC.length);
      const read = fs.readSync(fd, header, 0, header.length, 0);
      return read === header.length && header.toString('latin1') === SQLITE_MAGIC;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

export interface BackupSettings {
  autoBackupEnabled: boolean;
  backupDirectory: string;
  backupIntervalDays: number;
  lastBackupAt: string | null;
}

export function getDefaultBackupDir(_db: Database.Database): string {
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
          lastBackupAt: prefs.backup.lastBackupAt || null
        };
      }
    }
  } catch { /* intentionally ignored: non-fatal */ }

  return {
    autoBackupEnabled: true,
    backupDirectory: defaultDir,
    backupIntervalDays: 7,
    lastBackupAt: null
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
  } catch { /* malformed input: caller falls back to a default */ }

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
  if ([...dirPath].some(ch => ch.charCodeAt(0) < 0x20)) return false;
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
    } catch { /* best-effort cleanup: safe to ignore */ }
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
        } catch { /* best-effort cleanup: safe to ignore */ }
      }
    }
  } catch { /* best-effort cleanup: safe to ignore */ }

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
      try { testDb.close(); } catch { /* best-effort cleanup: safe to ignore */ }
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
    try { fs.unlinkSync(rollbackPath); } catch { /* best-effort cleanup: safe to ignore */ }
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
      try { if (fs.existsSync(stagePath + suffix)) fs.unlinkSync(stagePath + suffix); } catch { /* best-effort cleanup: safe to ignore */ }
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
    logger.info('Database', `Scheduled backup created: ${backup.filename}`);

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
      ...(backupIntervalDays ? { backupIntervalDays: Number(backupIntervalDays) } : {})
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
      try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup: safe to ignore */ }
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
      try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup: safe to ignore */ }
      throw cleanErr;
    }

    res.download(tmpPath, `runs-backup-${dateStr}.db`, (_err) => {
      // Clean up the temporary snapshot file after download completes or errors
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch { /* best-effort cleanup: safe to ignore */ }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to download database snapshot' });
  }
});

// POST /api/database/restore - restore the active database from an uploaded .db file.
// Accepts either a raw binary body (application/octet-stream, streamed to disk) or
// the legacy base64-in-JSON payload.
databaseRouter.post('/restore', async (req: Request, res: Response) => {
  const tmpCandidatePath = path.join(os.tmpdir(), `restore-candidate-${Date.now()}.db`);

  const cleanup = () => {
    try {
      if (fs.existsSync(tmpCandidatePath)) fs.unlinkSync(tmpCandidatePath);
    } catch { /* best-effort cleanup: safe to ignore */ }
  };

  const finish = (result: { success: boolean; error?: string; activityCount?: number; safetyBackupPath?: string }) => {
    cleanup();
    if (!result.success) {
      return res.status(422).json({ error: result.error || 'Failed to restore database' });
    }
    res.json({
      status: 'ok',
      activityCount: result.activityCount,
      safetyBackupPath: result.safetyBackupPath
    });
  };

  try {
    const contentType = String(req.headers['content-type'] || '');

    if (contentType.includes('application/octet-stream')) {
      // Stream straight to disk: no base64 inflation and no double buffering, so
      // the practical ceiling is disk space rather than process memory.
      const saved = await saveStreamToFile(req, tmpCandidatePath, MAX_BINARY_RESTORE_BYTES);
      if (!saved.ok) {
        cleanup();
        return res.status(saved.tooLarge ? 413 : 400).json({
          error: saved.tooLarge
            ? `Database payload exceeds the maximum permitted size (${Math.round(MAX_BINARY_RESTORE_BYTES / (1024 * 1024))} MB).`
            : `Failed to receive the database payload: ${saved.error}`
        });
      }
      if (!hasSqliteHeader(tmpCandidatePath)) {
        cleanup();
        return res.status(422).json({ error: 'That file is not a SQLite database (unexpected file header).' });
      }
      return finish(restoreDatabaseFromFile(tmpCandidatePath));
    }

    // Legacy base64-in-JSON path, kept so older clients keep working.
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
    fs.writeFileSync(tmpCandidatePath, Buffer.from(cleanBase64, 'base64'));
    return finish(restoreDatabaseFromFile(tmpCandidatePath));
  } catch (err: any) {
    cleanup();
    res.status(500).json({ error: err.message || 'Failed to restore database' });
  }
});

// POST /api/database/restore-gdrive removed: Google Drive sync was retired because the
// database grows past what is sensible to mirror into a personal Drive quota, and run
// data can be re-exported from Garmin at any time.
