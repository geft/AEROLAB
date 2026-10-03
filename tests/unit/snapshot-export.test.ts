import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportSnapshot, SNAPSHOT_SCHEMA_VERSION, validateSnapshot } from '../../scripts/export-snapshot.js';
import { getActivityDetailService } from '../../src/backend/services/activity-service.js';
import { decodeSnapshot } from '../../src/shared/snapshot-codec.js';

const temporaryDirectories: string[] = [];
function makeDatabase(withActivity = false, startTime = '2026-09-01T07:00:00Z'): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-snapshot-'));
  temporaryDirectories.push(directory);
  const file = path.join(directory, 'runs.db');
  const db = new Database(file);
  db.exec(fs.readFileSync(path.resolve('src/backend/db/schema.sql'), 'utf8'));
  db.prepare("INSERT INTO athlete_profile (id, resting_hr, max_hr, is_configured) VALUES ('primary', 50, 190, 1)").run();
  if (withActivity) {
    db.prepare(`INSERT INTO activities (id, start_time, name, run_type, distance_meters, duration_seconds,
      avg_pace_sec_km, workout_lat, workout_lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('private-run-id', startTime, 'Test run', 'easy_base', 5000, 1800, 360, 1.23456, 103.12345);
  }
  db.close();
  return file;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('snapshot exporter', () => {
  it('samples exported charts after analysis without changing summaries or database records', () => {
    const dbPath = makeDatabase(true);
    const db = new Database(dbPath);
    const insert = db.prepare(`INSERT INTO activity_records
      (activity_id, timestamp, elapsed_seconds, distance_m, speed_mps, heart_rate, cadence, altitude_m)
      VALUES ('private-run-id', ?, ?, ?, 3, 140, 180, 12)`);
    db.transaction(() => {
      for (let second = 0; second <= 300; second++) {
        insert.run(new Date(Date.parse('2026-09-01T07:00:00Z') + second * 1000).toISOString(), second, second * 3);
      }
    })();
    db.prepare('INSERT INTO activity_fit_details (activity_id, metadata_json) VALUES (?, ?)')
      .run('private-run-id', JSON.stringify({ session: { manufacturer: 'test-device' }, exportOnly: 'desktop FIT metadata' }));
    const original = getActivityDetailService(db, 'private-run-id', { persistCoachSummary: false })!;
    db.close();

    const output = path.join(path.dirname(dbPath), 'snapshot.msgpack.gz');
    exportSnapshot(dbPath, output);
    const detail = decodeSnapshot(fs.readFileSync(output)).details['private-run-id'];
    expect(detail.records.length).toBeLessThan(original.records.length / 2);
    expect(detail.records[0].elapsed_seconds).toBe(original.records[0].elapsed_seconds);
    expect(detail.records.at(-1)!.elapsed_seconds).toBe(original.records.at(-1)!.elapsed_seconds);
    expect(detail.splits).toEqual(original.splits);
    expect(detail.intervals).toEqual(original.intervals);
    expect(detail.coachSummary).toEqual(original.coachSummary);
    expect(original.fitMetadata).toHaveProperty('exportOnly', 'desktop FIT metadata');
    expect(detail).not.toHaveProperty('fitMetadata');

    const readonly = new Database(dbPath, { readonly: true });
    expect(readonly.prepare('SELECT COUNT(*) AS count FROM activity_records').get()).toEqual({ count: 301 });
    readonly.close();
  });

  it('exports a versioned empty snapshot with a generated timestamp', () => {
    const dbPath = makeDatabase();
    const output = path.join(path.dirname(dbPath), 'snapshot.msgpack.gz');
    exportSnapshot(dbPath, output);
    const snapshot = decodeSnapshot(fs.readFileSync(output));
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(Date.parse(snapshot.generatedAt)).not.toBeNaN();
    expect(snapshot.activities).toEqual([]);
    expect(snapshot.details).toEqual({});
    expect(() => validateSnapshot(snapshot)).not.toThrow();
  });

  it('omits coordinates and private database fields while retaining stable activity detail', () => {
    const dbPath = makeDatabase(true);
    const output = path.join(path.dirname(dbPath), 'snapshot.msgpack.gz');
    exportSnapshot(dbPath, output);
    const snapshot = decodeSnapshot(fs.readFileSync(output));
    expect(snapshot.activities[0]).toMatchObject({ id: 'private-run-id', start_time: '2026-09-01T07:00:00Z' });
    expect(snapshot.activities[0]).not.toHaveProperty('workout_lat');
    expect(snapshot.activities[0]).not.toHaveProperty('workout_lon');
    expect(snapshot.profile.profile).not.toHaveProperty('dob');
    expect(snapshot.profile.profile).not.toHaveProperty('location');
    expect(JSON.stringify(snapshot)).not.toMatch(/workout_lat|workout_lon|"lat"|"lon"|databasePath|sessionToken/);
  });

  it('rejects invalid databases and preserves an existing artifact when export fails', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-snapshot-'));
    temporaryDirectories.push(directory);
    const invalidDb = path.join(directory, 'invalid.db');
    fs.writeFileSync(invalidDb, 'not sqlite');
    const destination = path.join(directory, 'snapshot.json');
    fs.writeFileSync(destination, 'previous-complete-snapshot');
    expect(() => exportSnapshot(invalidDb, destination)).toThrow();
    expect(fs.readFileSync(destination, 'utf8')).toBe('previous-complete-snapshot');
  });

  it('rejects unsupported schema versions and malformed activity identities or dates', () => {
    const base = { schemaVersion: SNAPSHOT_SCHEMA_VERSION, generatedAt: '2026-09-26T00:00:00.000Z', activities: [], details: {}, profile: {}, bestEfforts: {}, progressByRunType: {}, thresholdsByRunType: {}, volume: {}, trainingLoadByDays: {} };
    expect(() => validateSnapshot({ ...base, schemaVersion: 99 })).toThrow('Unsupported snapshot schema version');
    expect(() => validateSnapshot({ ...base, activities: [{ id: '', start_time: 'bad' }] })).toThrow('activity IDs');
  });
});
