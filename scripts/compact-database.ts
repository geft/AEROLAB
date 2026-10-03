import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { getDatabasePath } from '../src/backend/db/path.js';
import { decodeSourceFit, decodeStoredJson, loadArchivedFields, migrateCompression } from '../src/backend/db/compression.js';
import { checkpointWal, configureWal } from '../src/backend/db/wal.js';

/** Compare all logical rows, including exact raw JSON and original binary FIT data. */
function fingerprint(db: Database.Database): string {
  const hash = createHash('sha256');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations','activity_record_archives') ORDER BY name").all() as Array<{ name: string }>;
  for (const { name } of tables) {
    hash.update(name);
    const quoted = `"${name.replaceAll('"', '""')}"`;
    let activityId: string | null = null;
    let archive = new Map<number, string>();
    const order = name === 'activity_records' ? 'activity_id, id' : 'rowid';
    for (const row of db.prepare(`SELECT * FROM ${quoted} ORDER BY ${order}`).iterate() as Iterable<Record<string, unknown>>) {
      if (name === 'activity_records') {
        if (row.activity_id !== activityId) {
          activityId = row.activity_id as string;
          archive = loadArchivedFields(db, activityId);
        }
        row.fit_fields_json = row.fit_fields_json ?? archive.get(row.id as number) ?? null;
      } else if (name === 'activity_fit_details') {
        row.metadata_json = decodeStoredJson(row.metadata_json as string | Buffer);
        if (row.source_fit) row.source_fit = decodeSourceFit(row.source_fit as Buffer);
      }
      hash.update(JSON.stringify(row));
      hash.update('\n');
    }
  }
  return hash.digest('hex');
}

function compact(db: Database.Database): void {
  configureWal(db);
  db.pragma('foreign_keys = ON');
  db.transaction(() => {
    migrateCompression(db);
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    db.prepare('INSERT OR IGNORE INTO schema_migrations(name) VALUES(?)').run('lossless-fit-gzip-v1');
  }).immediate();
  db.exec('VACUUM');
  db.prepare('INSERT OR IGNORE INTO schema_migrations(name) VALUES(?)').run('lossless-fit-vacuum-v1');
  if (!checkpointWal(db)) throw new Error('WAL checkpoint is busy; close other app instances and retry');
  if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Database integrity check failed');
  if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Foreign key check failed');
}

const dbPath = getDatabasePath();
const apply = process.argv.includes('--apply');
const source = new Database(dbPath, { fileMustExist: true });
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-compaction-'));
try {
  if (!checkpointWal(source)) throw new Error('Close other app instances before compacting');
  const beforeBytes = fs.statSync(dbPath).size;
  const backupDir = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `pre-gzip-${randomUUID()}.db`);
  await source.backup(backupPath);
  const candidatePath = path.join(temporaryDir, 'candidate.db');
  fs.copyFileSync(backupPath, candidatePath);
  const candidate = new Database(candidatePath);
  let expected: string;
  let candidateBytes: number;
  try {
    expected = fingerprint(candidate);
    compact(candidate);
    if (fingerprint(candidate) !== expected) throw new Error('Compacted copy does not match original data');
    candidateBytes = fs.statSync(candidatePath).size;
  } finally { candidate.close(); }
  console.log(JSON.stringify({ verifiedCopy: true, beforeBytes, candidateBytes, backupPath }));
  if (apply) {
    if (fingerprint(source) !== expected) throw new Error('Database changed during verification; retry after closing the app');
    compact(source);
    if (fingerprint(source) !== expected) throw new Error(`Verification failed; safety backup: ${backupPath}`);
    console.log(JSON.stringify({ applied: true, databaseBytes: fs.statSync(dbPath).size, walBytes: fs.existsSync(`${dbPath}-wal`) ? fs.statSync(`${dbPath}-wal`).size : 0, allLogicalRowsIdentical: true }));
  }
} finally {
  source.close();
  const resolvedTemporaryDir = path.resolve(temporaryDir);
  if (path.dirname(resolvedTemporaryDir) !== path.resolve(os.tmpdir()) || !path.basename(resolvedTemporaryDir).startsWith('aerolab-compaction-')) {
    throw new Error('Unexpected temporary compaction directory');
  }
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}
