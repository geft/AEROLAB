import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listBackupFiles, pruneBackupFiles } from '../../src/backend/db/backup-retention.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function folder() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-retention-'));
  directories.push(directory);
  return directory;
}

function snapshot(directory: string, filename: string, order: number) {
  const file = path.join(directory, filename);
  fs.writeFileSync(file, 'snapshot');
  const time = new Date(2026, 0, order);
  fs.utimesSync(file, time, time);
  return file;
}

describe('backup retention', () => {
  it('bounds legacy rolling and safety files independently while leaving unrelated files alone', () => {
    const directory = folder();
    for (let i = 1; i <= 6; i++) {
      snapshot(directory, `runs-legacy-${i}.db`, i);
      snapshot(directory, `pre-migration-${i}.db`, i);
    }
    snapshot(directory, 'pre-gzip-65eae3df-c5dd-46ca-a879-6ecb70a2cbdf.db', 7);
    snapshot(directory, 'pre-restore-safety-65eae3df-c5dd-46ca-a879-6ecb70a2cbdf.db', 8);
    snapshot(directory, 'personal.db', 1);
    snapshot(directory, 'pre-migration-not-a-timestamp.db', 1);
    fs.mkdirSync(path.join(directory, 'runs-directory.db'));

    pruneBackupFiles(directory);

    expect(listBackupFiles(directory, 'rolling').map(file => file.filename)).toEqual([
      'runs-legacy-6.db', 'runs-legacy-5.db', 'runs-legacy-4.db'
    ]);
    expect(listBackupFiles(directory, 'safety').map(file => file.filename)).toEqual([
      'pre-restore-safety-65eae3df-c5dd-46ca-a879-6ecb70a2cbdf.db',
      'pre-gzip-65eae3df-c5dd-46ca-a879-6ecb70a2cbdf.db', 'pre-migration-6.db'
    ]);
    expect(fs.existsSync(path.join(directory, 'personal.db'))).toBe(true);
    expect(fs.existsSync(path.join(directory, 'pre-migration-not-a-timestamp.db'))).toBe(true);
    expect(fs.statSync(path.join(directory, 'runs-directory.db')).isDirectory()).toBe(true);
  });

  it('protects the new snapshot and skips files with SQLite sidecars until a later cleanup', () => {
    const directory = folder();
    for (let i = 1; i <= 5; i++) snapshot(directory, `pre-migration-${i}.db`, i);
    const protectedFile = path.join(directory, 'pre-migration-1.db');
    const lockedFile = path.join(directory, 'pre-migration-2.db');
    fs.writeFileSync(`${lockedFile}-wal`, 'active');

    pruneBackupFiles(directory, protectedFile);
    expect(fs.existsSync(protectedFile)).toBe(true);
    expect(fs.existsSync(lockedFile)).toBe(true);
    expect(fs.existsSync(path.join(directory, 'pre-migration-3.db'))).toBe(false);

    fs.unlinkSync(`${lockedFile}-wal`);
    pruneBackupFiles(directory, protectedFile);
    expect(listBackupFiles(directory)).toHaveLength(3);
    expect(fs.existsSync(lockedFile)).toBe(false);
  });
});
