import fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { getProgressHistoryService, getVolumeService } from '../../src/backend/services/activity-service.js';
import { getThresholdsService } from '../../src/backend/services/thresholds-service.js';

describe('validated database query boundaries', () => {
  let db: Database.Database | null = null;
  afterEach(() => { db?.close(); db = null; });

  function database(): Database.Database {
    db = new Database(':memory:');
    db.exec(fs.readFileSync('src/backend/db/schema.sql', 'utf8'));
    db.prepare("INSERT INTO athlete_profile (id) VALUES ('primary')").run();
    return db;
  }

  it('rejects malformed numeric rows returned to progress and volume queries', () => {
    const connection = database();
    connection.prepare("INSERT INTO activities (id, start_time, distance_meters, duration_seconds) VALUES ('bad', '2026-09-01', 'five', 600)").run();
    expect(() => getVolumeService(connection, { period: 'all' })).toThrow('activities.distance_meters');
    expect(() => getProgressHistoryService(connection, 'all')).toThrow('activities.distance_meters');
  });

  it('rejects malformed threshold calibration rows before returning the API response', () => {
    const connection = database();
    connection.prepare("INSERT INTO physiological_thresholds (effective_date, lt1_hr) VALUES ('2026-09-01', 'fast')").run();
    expect(() => getThresholdsService(connection)).toThrow('physiological_thresholds.lt1_hr');
  });
});
