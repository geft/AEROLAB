import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { getDatabase } from '../db/client.js';

export const databaseRouter = Router();

export interface BackupSettings {
  autoBackupEnabled: boolean;
  backupDirectory: string;
  backupIntervalDays: number;
  lastBackupAt: string | null;
}

export function getDefaultBackupDir(db: Database.Database): string {
  // Check if DATABASE_PATH is defined
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
  } catch {}

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

export function createDatabaseBackup(db: Database.Database, targetDirectory?: string, maxBackups: number = 10): { filePath: string; filename: string; sizeBytes: number; createdAt: string } {
  const settings = getBackupSettings(db);
  const backupDir = targetDirectory || settings.backupDirectory || getDefaultBackupDir(db);

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

export function checkAndRunScheduledBackup(db: Database.Database): boolean {
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

    createDatabaseBackup(db, settings.backupDirectory);
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

    res.json({
      dbPath,
      sizeBytes,
      sizeMb: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
      activityCount,
      settings,
      recentBackups: backups.slice(0, 5)
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
    const { autoBackupEnabled, backupDirectory, backupIntervalDays } = req.body || {};
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
      try { fs.unlinkSync(tmpPath); } catch {}
    }

    // Create a safe snapshot
    const normalized = tmpPath.replace(/\\/g, '/').replace(/'/g, "''");
    db.prepare(`VACUUM INTO '${normalized}'`).run();

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
