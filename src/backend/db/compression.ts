import { gzipSync, gunzipSync } from 'node:zlib';
import type Database from 'better-sqlite3';

// Explicit marker distinguishes compressed source FIT bytes from original files.
const FIT_GZIP_MARKER = Buffer.from('AEROLAB-FIT-GZIP-v1\0');

export function decodeStoredJson(value: string | Buffer): string {
  return typeof value === 'string' ? value : gunzipSync(value).toString('utf8');
}

export function encodeStoredJson(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : gzipSync(Buffer.from(value), { level: 9 });
}

export function decodeSourceFit(value: Buffer): Buffer {
  return value.subarray(0, FIT_GZIP_MARKER.length).equals(FIT_GZIP_MARKER)
    ? gunzipSync(value.subarray(FIT_GZIP_MARKER.length)) : value;
}

function encodeSourceFit(value: Buffer): Buffer {
  if (value.subarray(0, FIT_GZIP_MARKER.length).equals(FIT_GZIP_MARKER)) return value;
  return Buffer.concat([FIT_GZIP_MARKER, gzipSync(value, { level: 9 })]);
}

export const RECORD_ARCHIVE_SCHEMA = `CREATE TABLE IF NOT EXISTS activity_record_archives (
  activity_id TEXT PRIMARY KEY,
  fields_gzip BLOB NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
)`;

/** Must be called inside the import/migration transaction. Preserve exact JSON strings. */
export function compressActivity(db: Database.Database, activityId: string): void {
  const fields = db.prepare('SELECT id, fit_fields_json FROM activity_records WHERE activity_id = ? AND fit_fields_json IS NOT NULL ORDER BY id')
    .all(activityId) as Array<{ id: number; fit_fields_json: string }>;
  if (fields.length) {
    const previous = loadArchivedFields(db, activityId);
    for (const row of fields) previous.set(row.id, row.fit_fields_json);
    db.prepare(`INSERT INTO activity_record_archives(activity_id, fields_gzip) VALUES (?, ?)
      ON CONFLICT(activity_id) DO UPDATE SET fields_gzip = excluded.fields_gzip`)
      .run(activityId, gzipSync(Buffer.from(JSON.stringify([...previous])), { level: 9 }));
    db.prepare('UPDATE activity_records SET fit_fields_json = NULL WHERE activity_id = ?').run(activityId);
  }
  const fit = db.prepare('SELECT metadata_json, source_fit FROM activity_fit_details WHERE activity_id = ?').get(activityId) as
    { metadata_json: string | Buffer; source_fit: Buffer | null } | undefined;
  if (fit) db.prepare('UPDATE activity_fit_details SET metadata_json = ?, source_fit = ? WHERE activity_id = ?')
    .run(encodeStoredJson(fit.metadata_json), fit.source_fit ? encodeSourceFit(fit.source_fit) : null, activityId);
}

export function loadArchivedFields(db: Database.Database, activityId: string): Map<number, string> {
  // Read-only legacy snapshots may predate the archive table.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='activity_record_archives'").get()) return new Map();
  const row = db.prepare('SELECT fields_gzip FROM activity_record_archives WHERE activity_id = ?').get(activityId) as { fields_gzip: Buffer } | undefined;
  if (!row) return new Map();
  const entries: unknown = JSON.parse(gunzipSync(row.fields_gzip).toString('utf8'));
  if (!Array.isArray(entries) || entries.some(entry => !Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) || typeof entry[1] !== 'string')) {
    throw new Error('Invalid compressed FIT record archive');
  }
  return new Map(entries as Array<[number, string]>);
}

/** Export boundary restores raw fields without inflating them during analysis. */
export function loadExportFields(db: Database.Database, activityId: string): Array<string | null> {
  const archived = loadArchivedFields(db, activityId);
  const columns = db.prepare('PRAGMA table_info(activity_records)').all() as Array<{ name: string }>;
  const field = columns.some(column => column.name === 'fit_fields_json') ? 'fit_fields_json' : 'NULL AS fit_fields_json';
  return (db.prepare(`SELECT id, ${field} FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC`).all(activityId) as
    Array<{ id: number; fit_fields_json: string | null }>).map(row => row.fit_fields_json ?? archived.get(row.id) ?? null);
}

/** One-time migration; the caller owns its snapshot, transaction and checkpoint. */
export function migrateCompression(db: Database.Database): void {
  db.exec(RECORD_ARCHIVE_SCHEMA);
  const activities = db.prepare('SELECT id FROM activities').all() as Array<{ id: string }>;
  for (const { id } of activities) compressActivity(db, id);
}
