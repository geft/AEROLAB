import { pruneBackupFiles } from './backup-retention.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { closeDatabase, getDatabase } from './client.js';
import { reserveDatabaseOperation, withDatabaseOperation, currentDatabaseOperation } from '../application/database-operations.js';

export type StorageErrorCode = 'INVALID_DATABASE' | 'DATABASE_BUSY' | 'DESTINATION_EXISTS' | 'COPY_FAILED' | 'RESTORE_FAILED';
export type StorageResult<T> = { ok: true; value: T } | { ok: false; code: StorageErrorCode; error: string };

export function createSnapshot(db: Database.Database, destination: string): void {
  return withDatabaseOperation('storage', () => createSnapshotWithLock(db, destination));
}

function createSnapshotWithLock(db: Database.Database, destination: string): void {
  if (fs.existsSync(destination)) throw new Error('Snapshot destination already exists');
  db.prepare(`VACUUM INTO '${destination.replace(/\\/g, '/').replace(/'/g, "''")}'`).run();
}

export function validateDatabaseSnapshot(filePath: string): { valid: boolean; activityCount: number; error?: string } {
  if (!fs.existsSync(filePath)) return { valid: false, activityCount: 0, error: 'File does not exist' };
  try {
    const header = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
    if (header.toString('latin1') !== 'SQLite format 3\0') {
      return { valid: false, activityCount: 0, error: 'File is not a valid SQLite database format' };
    }
  } catch (error) {
    return { valid: false, activityCount: 0, error: `Cannot read file header: ${String(error)}` };
  }

  let candidate: Database.Database | null = null;
  try {
    candidate = new Database(filePath, { readonly: true, fileMustExist: true });
    const check = candidate.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (check[0]?.integrity_check !== 'ok') {
      return { valid: false, activityCount: 0, error: 'Database failed SQLite integrity check' };
    }
    const columns = new Set((candidate.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(row => row.name));
    if (!['id', 'start_time', 'run_type', 'distance_meters', 'duration_seconds'].every(column => columns.has(column))) {
      return { valid: false, activityCount: 0, error: 'Incompatible activities schema' };
    }
    const activityCount = (candidate.prepare('SELECT count(*) AS count FROM activities').get() as { count: number }).count;
    return { valid: true, activityCount };
  } catch (error) {
    return { valid: false, activityCount: 0, error: error instanceof Error ? error.message : 'Corrupt database file' };
  } finally {
    candidate?.close();
  }
}

/** Snapshot the live WAL-backed database into a new file, without overwriting. */
export async function copyCurrentDatabaseTo(destination: string): Promise<StorageResult<{ databasePath: string }>> {
  if (currentDatabaseOperation()) return { ok: false, code: 'DATABASE_BUSY', error: 'Workout analysis is updating; retry after it finishes' };
  const lease = reserveDatabaseOperation('storage');
  const stage = path.join(path.dirname(destination), `.aerolab-copy-${randomUUID()}.db`);
  try {
    if (fs.existsSync(destination)) return { ok: false, code: 'DESTINATION_EXISTS', error: 'Destination already exists' };
    await lease.run(() => getDatabase().backup(stage));
    fs.copyFileSync(stage, destination, fs.constants.COPYFILE_EXCL);
    return { ok: true, value: { databasePath: destination } };
  } catch (error) {
    return { ok: false, code: 'COPY_FAILED', error: error instanceof Error ? error.message : 'Failed to copy database' };
  } finally {
    try { if (fs.existsSync(stage)) fs.unlinkSync(stage); } catch { /* best effort */ }
    lease.release();
  }
}

export function restoreDatabaseFromFile(candidatePath: string): { success: boolean; activityCount: number; safetyBackupPath?: string; error?: string } {
  if (currentDatabaseOperation()) return { success: false, activityCount: 0, error: 'Workout analysis is updating; retry after it finishes' };
  const lease = reserveDatabaseOperation('storage');
  try {
    return lease.run(() => restoreWithLock(candidatePath));
  } finally {
    lease.release();
  }
}

function restoreWithLock(candidatePath: string): { success: boolean; activityCount: number; safetyBackupPath?: string; error?: string } {
  const validation = validateDatabaseSnapshot(candidatePath);
  if (!validation.valid) return { success: false, activityCount: 0, error: validation.error };
  const activeDbPath = getDatabase().name;
  if (activeDbPath === ':memory:') return { success: false, activityCount: 0, error: 'Restore requires a file-backed database' };

  const targetDir = path.dirname(activeDbPath);
  fs.mkdirSync(targetDir, { recursive: true });
  const stagePath = path.join(targetDir, `.restore-stage-${randomUUID()}.db`);
  const rollbackPath = path.join(targetDir, `.restore-rollback-${randomUUID()}.db`);
  let safetyBackupPath: string | undefined;
  let movedOriginal = false;
  let installedCandidate = false;
  try {
    fs.copyFileSync(candidatePath, stagePath);
    // The candidate was validated read-only. A raw file copy has no open WAL
    // connection, so validating it must not run startup migrations here.

    const activeDb = getDatabase();
    const backupDir = path.join(targetDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    safetyBackupPath = path.join(backupDir, `pre-restore-safety-${randomUUID()}.db`);
    createSnapshot(activeDb, safetyBackupPath);
    pruneBackupFiles(backupDir, safetyBackupPath);
    const checkpoint = activeDb.pragma('wal_checkpoint(TRUNCATE)') as Array<{ busy: number }>;
    if (checkpoint.some(row => row.busy !== 0)) throw new Error('Database is busy; close other connections before restoring');
    closeDatabase();

    fs.renameSync(activeDbPath, rollbackPath);
    movedOriginal = true;
    fs.renameSync(stagePath, activeDbPath);
    installedCandidate = true;
    const newDb = getDatabase(activeDbPath);
    const activityCount = (newDb.prepare('SELECT count(*) AS count FROM activities').get() as { count: number }).count;
    try { fs.unlinkSync(rollbackPath); } catch { /* best effort */ }
    return { success: true, activityCount, safetyBackupPath };
  } catch (error) {
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
    return { success: false, activityCount: 0, safetyBackupPath, error: error instanceof Error ? error.message : 'Restore failed' };
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { if (fs.existsSync(stagePath + suffix)) fs.unlinkSync(stagePath + suffix); } catch { /* best effort */ }
    }
  }
}
