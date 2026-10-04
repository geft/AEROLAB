import fs from 'node:fs';
import path from 'node:path';

export interface BackupFile {
  filename: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
}

type BackupKind = 'rolling' | 'safety';
const RETAINED_BACKUPS = 3;

function backupKind(filename: string): BackupKind | null {
  if (/^runs-.+\.db$/.test(filename)) return 'rolling';
  if (/^pre-migration-\d+\.db$/.test(filename)
    || /^pre-(?:gzip|restore-safety)-[0-9a-f-]{36}\.db$/.test(filename)) return 'safety';
  return null;
}

/** Only app-owned snapshot files are eligible; directories and symlinks are excluded. */
export function listBackupFiles(directory: string, kind?: BackupKind): BackupFile[] {
  try {
    return fs.readdirSync(directory).flatMap(filename => {
      const category = backupKind(filename);
      if (!category || (kind && category !== kind)) return [];
      const filePath = path.join(directory, filename);
      try {
        const stats = fs.lstatSync(filePath);
        if (!stats.isFile()) return [];
        return [{ filename, filePath, sizeBytes: stats.size, createdAt: stats.mtime.toISOString() }];
      } catch { return []; }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.filename.localeCompare(a.filename));
  } catch { return []; }
}

/** Keep three rolling snapshots and three safety snapshots independently. */
export function pruneBackupFiles(directory: string, protectedPath?: string): void {
  for (const kind of ['rolling', 'safety'] as const) {
    const backups = listBackupFiles(directory, kind);
    // A just-created recovery point must survive even when timestamps tie.
    const ordered = protectedPath
      ? [...backups.filter(file => file.filePath === protectedPath), ...backups.filter(file => file.filePath !== protectedPath)]
      : backups;
    for (const old of ordered.slice(RETAINED_BACKUPS)) {
      try {
        // Never remove snapshots with active SQLite sidecars.
        if (fs.existsSync(`${old.filePath}-wal`) || fs.existsSync(`${old.filePath}-shm`)) continue;
        fs.unlinkSync(old.filePath);
      } catch { /* Locked or concurrently removed snapshots are retried next time. */ }
    }
  }
}
