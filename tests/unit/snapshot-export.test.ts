import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportSnapshot, SNAPSHOT_SCHEMA_VERSION, validateSnapshot } from '../../scripts/export-snapshot.js';

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
  it('exports a versioned empty snapshot with a generated timestamp', () => {
    const dbPath = makeDatabase();
    const output = path.join(path.dirname(dbPath), 'snapshot.json');
    exportSnapshot(dbPath, output);
    const snapshot = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(Date.parse(snapshot.generatedAt)).not.toBeNaN();
    expect(snapshot.activities).toEqual([]);
    expect(snapshot.details).toEqual({});
    expect(() => validateSnapshot(snapshot)).not.toThrow();
  });

  it('omits coordinates and private database fields while retaining stable activity detail', () => {
    const dbPath = makeDatabase(true);
    const output = path.join(path.dirname(dbPath), 'snapshot.json');
    exportSnapshot(dbPath, output);
    const snapshot = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(snapshot.activities[0]).toMatchObject({ id: 'private-run-id', start_time: '2026-09-01T07:00:00Z' });
    expect(snapshot.activities[0]).not.toHaveProperty('workout_lat');
    expect(snapshot.activities[0]).not.toHaveProperty('workout_lon');
    expect(snapshot.profile.profile).not.toHaveProperty('dob');
    expect(snapshot.profile.profile).not.toHaveProperty('location');
    expect(fs.readFileSync(output, 'utf8')).not.toMatch(/workout_lat|workout_lon|"lat"|"lon"|databasePath|sessionToken/);
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
    const base = { schemaVersion: 1, generatedAt: '2026-09-26T00:00:00.000Z', activities: [], details: {}, profile: {}, bestEfforts: {}, progressByRunType: {}, thresholdsByRunType: {}, volume: {}, trainingLoadByDays: {} };
    expect(() => validateSnapshot({ ...base, schemaVersion: 2 })).toThrow('Unsupported snapshot schema version');
    expect(() => validateSnapshot({ ...base, activities: [{ id: '', start_time: 'bad' }] })).toThrow('activity IDs');
  });
});
