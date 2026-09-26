import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportSnapshot, validateSnapshot } from '../../scripts/export-snapshot.js';

const temporaryDirectories: string[] = [];

function makeLegacySnapshotDatabase(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-legacy-snapshot-'));
  temporaryDirectories.push(directory);
  const databasePath = path.join(directory, 'runs.db');
  const db = new Database(databasePath);
  db.exec(fs.readFileSync(path.resolve('src/backend/db/schema.sql'), 'utf8'));
  db.prepare("INSERT INTO athlete_profile (id, age, gender, resting_hr, max_hr, is_configured) VALUES ('primary', 37, 'Male', 50, 190, 1)").run();
  db.prepare(`INSERT INTO activities (id, start_time, name, run_type, distance_meters, duration_seconds,
    avg_pace_sec_km, workout_lat, workout_lon) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('legacy-run-id', '2026-09-01T07:00:00Z', 'Legacy run', 'easy_base', 5000, 1800, 360, 1.23456, 103.12345);
  db.prepare(`INSERT INTO activity_records (activity_id, timestamp, elapsed_seconds, distance_m, speed_mps)
    VALUES ('legacy-run-id', '2026-09-01T07:00:00Z', 0, 0, 0)`).run();

  // A saved backup can predate these columns even though the current app schema
  // and the live database know about them.
  db.exec('ALTER TABLE activities DROP COLUMN weather_pm25_source');
  db.exec('ALTER TABLE activities DROP COLUMN weather_pm25_ug_m3');
  db.close();
  return databasePath;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('snapshot export from existing backup databases', () => {
  it('exports and validates a legacy backup without altering its SQLite schema', () => {
    const databasePath = makeLegacySnapshotDatabase();
    const outputPath = path.join(path.dirname(databasePath), 'snapshot.json');

    expect(() => exportSnapshot(databasePath, outputPath)).not.toThrow();

    const snapshot = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    expect(() => validateSnapshot(snapshot)).not.toThrow();
    expect(snapshot.activities).toHaveLength(1);
    expect(snapshot.activities[0]).toMatchObject({
      id: 'legacy-run-id',
      start_time: '2026-09-01T07:00:00Z',
      weather_pm25_ug_m3: null,
      weather_pm25_source: null
    });
    expect(snapshot.details['legacy-run-id']).toBeDefined();
    expect(snapshot.details['legacy-run-id'].records[0].timestamp).toBe('2026-09-01T07:00:00Z');
    expect(snapshot.profile.profile).toMatchObject({ age: 37, gender: 'Male' });
    expect(snapshot.volume['all:current'].totalDistanceKm).toBe(5);

    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    const activityColumns = (db.pragma('table_info(activities)') as Array<{ name: string }>).map(column => column.name);
    db.close();
    expect(activityColumns).not.toContain('weather_pm25_ug_m3');
    expect(activityColumns).not.toContain('weather_pm25_source');
  });
});
