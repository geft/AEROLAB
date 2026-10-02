import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/client.js';
import { getDatabasePath, saveDatabasePath } from '../db/path.js';
import { copyCurrentDatabaseTo, createSnapshot, restoreDatabaseFromFile, validateDatabaseSnapshot } from '../db/storage.js';
import { startMaintenance } from '../jobs/maintenance.js';

export { restoreDatabaseFromFile, validateDatabaseSnapshot } from '../db/storage.js';

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
  * a 256 MB default cap bounds synchronous validation work. Override with
  * MAX_RESTORE_BYTES if a larger snapshot is required.
 */
const MAX_BINARY_RESTORE_BYTES = Number(process.env.MAX_RESTORE_BYTES) || 256 * 1024 * 1024;

const AUTOMATIC_BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

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
  backupDirectory: string;
}

export function getDefaultBackupDir(db: Database.Database): string {
  const dbPath = db.name;
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
          backupDirectory: prefs.backup.backupDirectory || defaultDir
        };
      }
    }
  } catch { /* intentionally ignored: non-fatal */ }

  return {
    backupDirectory: defaultDir
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
      .flatMap(f => {
        const filePath = path.join(directory, f);
        try {
          const stats = fs.lstatSync(filePath);
          if (!stats.isFile()) return [];
          return [{
            filename: f,
            filePath,
            sizeBytes: stats.size,
            createdAt: stats.mtime.toISOString()
          }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

/** Remove older rolling snapshots so retention also applies to files created under an older policy. */
export function pruneBackups(directory: string): Array<{ filename: string; filePath: string; sizeBytes: number; createdAt: string }> {
  const backups = listBackups(directory);
  const maxBackups = 3;
  if (backups.length <= maxBackups) return backups;

  for (const old of backups.slice(maxBackups)) {
    try {
      fs.unlinkSync(old.filePath);
    } catch {
      // Best effort: a locked or concurrently removed file should not break status reporting.
    }
  }

  return listBackups(directory);
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

function runFolderPicker(command: string, args: string[]): Promise<string | null> {
  return new Promise(resolve => {
    let picker;
    try {
      picker = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: false
      });
    } catch {
      resolve(null);
      return;
    }
    let output = '';
    picker.stdout?.setEncoding('utf8');
    picker.stdout?.on('data', chunk => { output += chunk; });
    picker.once('error', () => resolve(null));
    picker.once('close', code => resolve(code === 0 ? output.trim() || null : null));
  });
}

/** Open the host OS folder chooser and return the selected absolute path. */
export function selectLocalFolder(title = 'Choose AEROLAB folder'): Promise<string | null> {
  if (process.platform === 'win32') {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$dialog.Description = '${title.replace(/'/g, "''")}'`,
      "$dialog.ShowNewFolderButton = $true",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.SelectedPath) }"
    ].join('; ');
    return runFolderPicker('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
  }

  if (process.platform === 'darwin') {
    const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return runFolderPicker('osascript', ['-e', `POSIX path of (choose folder with prompt "${escapedTitle}")`]);
  }

  return runFolderPicker('zenity', ['--file-selection', '--directory', `--title=${title}`])
    .then(folder => folder || runFolderPicker('kdialog', ['--getexistingdirectory', '', '--title', title]));
}

/** Select an existing database or a new filename in the host OS file chooser. */
export function selectDatabaseFile(): Promise<string | null> {
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.SaveFileDialog',
      "$dialog.Title = 'Choose database location'",
      "$dialog.Filter = 'SQLite database (*.db)|*.db|All files (*.*)|*.*'",
      "$dialog.FileName = 'runs.db'",
      '$dialog.OverwritePrompt = $false',
      '$dialog.CheckFileExists = $false',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dialog.FileName) }'
    ].join('; ');
    return runFolderPicker('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
  }
  if (process.platform === 'darwin') {
    return runFolderPicker('osascript', ['-e', 'POSIX path of (choose file name with prompt "Choose database location" default name "runs.db")']);
  }
  return runFolderPicker('zenity', ['--file-selection', '--save', '--filename=runs.db', '--title=Choose database location'])
    .then(file => file || runFolderPicker('kdialog', ['--getsavefilename', 'runs.db', '--title', 'Choose database location']));
}

export async function handleSelectFolder(
  _req: Request,
  res: Response,
  picker: () => Promise<string | null> = () => selectLocalFolder('Choose AEROLAB backup folder')
): Promise<void> {
  try {
    const folder = await picker();
    if (!folder) {
      res.json({ folder: null, cancelled: true });
      return;
    }

    const normalized = path.resolve(folder);
    let isDirectory = false;
    try {
      isDirectory = fs.existsSync(normalized) && fs.statSync(normalized).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isSafeBackupDirectory(normalized) || !isDirectory) {
      res.status(400).json({ error: 'Selected folder is invalid or unavailable.' });
      return;
    }

    res.json({ folder: normalized });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to select backup folder' });
  }
}

export function createDatabaseBackup(db: Database.Database, targetDirectory?: string): { filePath: string; filename: string; sizeBytes: number; createdAt: string } {
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
  createSnapshot(db, filePath);

  const stats = fs.statSync(filePath);
  const createdAt = now.toISOString();

  // Rotate old backups in this directory (keep newest N).
  pruneBackups(backupDir);

  return {
    filePath,
    filename,
    sizeBytes: stats.size,
    createdAt
  };
}

/** Create a rolling snapshot on app startup when the latest one is at least a week old. */
export function createAutomaticBackupIfDue(
  db: Database.Database,
  now = new Date()
): ReturnType<typeof createDatabaseBackup> | null {
  const { backupDirectory } = getBackupSettings(db);
  const latest = listBackups(backupDirectory)[0];
  if (latest) {
    const latestTime = Date.parse(latest.createdAt);
    if (Number.isFinite(latestTime) && now.getTime() - latestTime < AUTOMATIC_BACKUP_INTERVAL_MS) {
      return null;
    }
  }

  return createDatabaseBackup(db, backupDirectory);
}

// GET /api/database/status
databaseRouter.get('/status', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const dbPath = db.name;
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
      startupDbPath: getDatabasePath(),
      sizeBytes,
      sizeMb: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
      activityCount,
      settings,
      snapshots: backupsWithMb,
      recentBackups: backupsWithMb.slice(0, 3)
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve database status' });
  }
});

// The selected file becomes active when this build is restarted. Never swap a
// live SQLite connection, especially while it may have uncheckpointed WAL data.
databaseRouter.post('/select-database', async (_req: Request, res: Response) => {
  try {
    const databasePath = await selectDatabaseFile();
    res.json({ databasePath, exists: databasePath ? fs.existsSync(databasePath) : false });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to choose database file' });
  }
});

databaseRouter.post('/location', async (req: Request, res: Response) => {
  try {
    const databasePath = req.body?.databasePath;
    if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath)) {
      return res.status(400).json({ error: 'Choose an absolute database file path.' });
    }
    const selectedPath = path.normalize(databasePath);
    if (process.env.DATABASE_PATH && path.resolve(process.env.DATABASE_PATH) !== selectedPath) {
      return res.status(409).json({ code: 'DATABASE_PATH_OVERRIDE', error: 'DATABASE_PATH environment override is active. Remove it before changing the database location.' });
    }
    const exists = fs.existsSync(selectedPath);
    if (typeof req.body?.expectedExists === 'boolean' && req.body.expectedExists !== exists) {
      return res.status(409).json({ code: 'LOCATION_CHANGED', error: 'Selected file changed. Choose it again.' });
    }
    if (exists) {
      const validation = validateDatabaseSnapshot(selectedPath);
      if (!validation.valid) return res.status(400).json({ code: 'INVALID_DATABASE', error: validation.error });
      const configPath = saveDatabasePath(selectedPath);
      return res.json({ databasePath: selectedPath, configPath, restartRequired: true, copied: false });
    }
    const parent = path.dirname(selectedPath);
    let validParent = false;
    try { validParent = isSafeBackupDirectory(parent) && fs.statSync(parent).isDirectory(); } catch { /* unavailable folder */ }
    if (!validParent) {
      return res.status(400).json({ code: 'INVALID_FOLDER', error: 'Choose an existing storage folder.' });
    }
    const copy = await copyCurrentDatabaseTo(selectedPath);
    if (!copy.ok) return res.status(copy.code === 'DATABASE_BUSY' || copy.code === 'DESTINATION_EXISTS' ? 409 : 500).json({ code: copy.code, error: copy.error });
    const configPath = saveDatabasePath(selectedPath);
    return res.json({ databasePath: selectedPath, configPath, restartRequired: true, copied: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to set database location' });
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

// POST /api/database/snapshots/delete — remove one file from the configured backup folder.
databaseRouter.post('/snapshots/delete', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const filename = req.body?.filename;
    if (typeof filename !== 'string' || path.basename(filename) !== filename
      || !/^runs-[a-zA-Z0-9._-]+\.db$/.test(filename)) {
      return res.status(400).json({ code: 'INVALID_SNAPSHOT_NAME', error: 'Choose a valid local snapshot.' });
    }

    const directory = getBackupSettings(db).backupDirectory;
    const snapshot = listBackups(directory).find(item => item.filename === filename);
    if (!snapshot) return res.status(404).json({ code: 'SNAPSHOT_NOT_FOUND', error: 'Snapshot was not found.' });

    fs.unlinkSync(snapshot.filePath);
    res.json({ status: 'ok', filename });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete local snapshot.' });
  }
});

// POST /api/database/open-backup-folder — reveal the configured local snapshot folder.
databaseRouter.post('/open-backup-folder', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const directory = path.resolve(getBackupSettings(db).backupDirectory);
    if (!isSafeBackupDirectory(directory)) {
      return res.status(400).json({ error: 'The configured snapshot folder is invalid.' });
    }
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.statSync(directory).isDirectory()) {
      return res.status(400).json({ error: 'The configured snapshot path is not a folder.' });
    }

    const [command, args] = process.platform === 'win32'
      ? ['explorer.exe', [directory]]
      : process.platform === 'darwin'
        ? ['open', [directory]]
        : ['xdg-open', [directory]];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
    res.json({ status: 'ok' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Could not open the snapshot folder.' });
  }
});

// POST /api/database/settings
databaseRouter.post('/settings', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { backupDirectory } = req.body || {};

    if (backupDirectory && !isSafeBackupDirectory(String(backupDirectory).trim())) {
      return res.status(400).json({ error: 'Invalid or unsafe backup directory path.' });
    }

    const updated = saveBackupSettings(db, {
      ...(backupDirectory ? { backupDirectory: String(backupDirectory).trim() } : {})
    });
    res.json({
      status: 'ok',
      settings: updated
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update backup settings' });
  }
});

// POST /api/database/select-folder
databaseRouter.post('/select-folder', (req: Request, res: Response) => {
  void handleSelectFolder(req, res);
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
  const tmpCandidatePath = path.join(os.tmpdir(), `restore-candidate-${randomUUID()}.db`);

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
    if (process.env.NODE_ENV !== 'test') startMaintenance(getDatabase().name);
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
