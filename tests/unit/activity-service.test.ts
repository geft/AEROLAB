import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  getProgressHistoryService, getVolumeService, listActivitiesService, parseActivityUpdate, updateActivityService
} from '../../src/backend/services/activity-service.js';

describe('activity service input boundary', () => {
  it('rejects unsupported tags before touching the database', () => {
    const db = new Database(':memory:');
    try {
      expect(updateActivityService(db, 'run-1', { tags: ['Unexpected'] })).toMatchObject({
        ok: false,
        status: 400,
        code: 'ERR_INVALID_TAGS'
      });
    } finally {
      db.close();
    }
  });

  it('rejects an empty patch with a stable code', () => {
    const db = new Database(':memory:');
    try {
      expect(updateActivityService(db, 'run-1', {})).toMatchObject({
        ok: false,
        status: 400,
        code: 'ERR_NO_FIELDS_TO_UPDATE'
      });
    } finally {
      db.close();
    }
  });

  it('validates update shapes and rejects updates for a missing activity', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE activities (id TEXT PRIMARY KEY, max_heart_rate REAL, start_time TEXT, run_type TEXT)');
    try {
      expect(parseActivityUpdate(null)).toBeNull();
      expect(parseActivityUpdate([])).toBeNull();
      expect(parseActivityUpdate({ unknown: true })).toBeNull();
      expect(parseActivityUpdate({ name: 4 })).toBeNull();
      expect(parseActivityUpdate({ run_type: 4 })).toBeNull();
      expect(parseActivityUpdate({ is_failed_workout: 'yes' })).toBeNull();
      expect(parseActivityUpdate({ is_failed_workout: true })).toEqual({ is_failed_workout: true });
      expect(parseActivityUpdate({ tags: ['Easy Base', 4] })).toBeNull();
      expect(parseActivityUpdate({ tags: 'Easy Base' })).toEqual({ tags: 'Easy Base' });
      expect(updateActivityService(db, 'missing', { run_type: 'easy_base' })).toMatchObject({
        ok: false, status: 404, code: 'ERR_ACTIVITY_NOT_FOUND'
      });
      expect(updateActivityService(db, 'missing', { tags: '"Easy Base"' })).toMatchObject({ code: 'ERR_INVALID_TAGS' });
      expect(updateActivityService(db, 'missing', { tags: 'not json' })).toMatchObject({ code: 'ERR_INVALID_TAGS' });
    } finally {
      db.close();
    }
  });
});

function createAggregationDatabase() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE activities (
      id TEXT PRIMARY KEY, start_time TEXT NOT NULL, name TEXT, run_type TEXT,
      distance_meters REAL, duration_seconds REAL, avg_pace_sec_km REAL, avg_heart_rate REAL,
      efficiency_factor REAL, elevation_gain_m REAL, aerobic_decoupling_pct REAL,
      training_load REAL, z1_seconds REAL, z2_seconds REAL, z3_seconds REAL, z4_seconds REAL, z5_seconds REAL,
      max_heart_rate REAL
    );
    CREATE TABLE activity_records (activity_id TEXT, elapsed_seconds REAL, heart_rate REAL);
    CREATE TABLE activity_intervals (activity_id TEXT, type TEXT);
    CREATE TABLE physiological_thresholds (
      id INTEGER, effective_date TEXT, source_activity_id TEXT, lt1_hr REAL, lt1_pace_sec_km REAL,
      lt2_hr REAL, lt2_pace_sec_km REAL, baseline_economy_ef REAL, confidence REAL,
      is_estimated INTEGER, notes TEXT, distance_meters REAL, duration_seconds REAL
    );
  `);
  return db;
}

describe('activity aggregation services', () => {
  it('uses activity zone totals when present and reconstructs missing zone totals from telemetry', () => {
    const db = createAggregationDatabase();
    db.prepare(`INSERT INTO activities (id,start_time,distance_meters,duration_seconds,elevation_gain_m,efficiency_factor,
      run_type,training_load,z1_seconds,z2_seconds,z3_seconds,z4_seconds,z5_seconds,max_heart_rate)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('cached', '2026-09-01', 5000, 1800, 20, 1.2, 'easy_base', 50, 20, 100, 30, 10, 5, 160);
    db.prepare(`INSERT INTO activities (id,start_time,distance_meters,duration_seconds,elevation_gain_m,efficiency_factor,
      run_type,training_load,z1_seconds,z2_seconds,z3_seconds,z4_seconds,z5_seconds,max_heart_rate)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('raw', '2026-09-02', 3000, 1200, 5, null, 'easy_base', 20, null, null, null, null, null, 160);
    db.prepare('INSERT INTO activity_records VALUES (?,?,?)').run('raw', 0, 130);
    db.prepare('INSERT INTO activity_records VALUES (?,?,?)').run('raw', 4, 155);
    db.prepare('INSERT INTO activity_records VALUES (?,?,?)').run('raw', 12, 178);
    try {
      const summary = getVolumeService(db, { period: 'all' });
      expect(summary.activityCount).toBe(2);
      expect(summary.totalDistanceKm).toBe(8);
      expect(summary.avgEf).toBe(1.2);
      expect(summary.zones.z2.pct + summary.zones.z3.pct + summary.zones.z4.pct + summary.zones.z5.pct).toBeGreaterThan(0);
      expect(getVolumeService(db, { period: 'year', year: '2026' }).activityCount).toBe(2);
      expect(getVolumeService(db, { period: 'month', month: '2026-09' }).periodLabel).toBe('Month: 2026-09');
    } finally {
      db.close();
    }
  });

  it('filters activity lists and safely parses old or malformed coach verdict JSON', () => {
    const db = createAggregationDatabase();
    db.exec(`
      ALTER TABLE activities ADD COLUMN auto_run_type TEXT;
      ALTER TABLE activities ADD COLUMN avg_cadence REAL;
      ALTER TABLE activities ADD COLUMN calories REAL;
      ALTER TABLE activities ADD COLUMN avg_temperature REAL;
      ALTER TABLE activities ADD COLUMN avg_vertical_oscillation REAL;
      ALTER TABLE activities ADD COLUMN avg_stance_time REAL;
      ALTER TABLE activities ADD COLUMN meters_per_beat REAL;
      ALTER TABLE activities ADD COLUMN tags TEXT;
      ALTER TABLE activities ADD COLUMN steady_pace_sec_km REAL;
      ALTER TABLE activities ADD COLUMN steady_heart_rate REAL;
      ALTER TABLE activities ADD COLUMN steady_cadence REAL;
      ALTER TABLE activities ADD COLUMN steady_stance_time REAL;
      ALTER TABLE activities ADD COLUMN pause_duration_seconds REAL;
      ALTER TABLE activities ADD COLUMN walk_duration_seconds REAL;
      ALTER TABLE activities ADD COLUMN walk_distance_meters REAL;
      ALTER TABLE activities ADD COLUMN weather_temperature_c REAL;
      ALTER TABLE activities ADD COLUMN weather_humidity_pct REAL;
      ALTER TABLE activities ADD COLUMN weather_apparent_temp_c REAL;
      ALTER TABLE activities ADD COLUMN weather_pm25_ug_m3 REAL;
      ALTER TABLE activities ADD COLUMN weather_pm25_source TEXT;
      ALTER TABLE activities ADD COLUMN weather_condition TEXT;
      ALTER TABLE activities ADD COLUMN weather_code REAL;
      ALTER TABLE activities ADD COLUMN weather_fetched_at TEXT;
      ALTER TABLE activities ADD COLUMN weather_source TEXT;
      ALTER TABLE activities ADD COLUMN workout_lat REAL;
      ALTER TABLE activities ADD COLUMN workout_lon REAL;
      CREATE TABLE activity_coach_summaries (activity_id TEXT, effectiveness_score REAL, analysis_json TEXT);
      INSERT INTO activities (id,start_time,name,run_type,distance_meters,duration_seconds) VALUES
        ('valid','2026-01-01','Valid','easy_base',5000,1800),
        ('broken','2026-01-02','Broken','race',1000,400),
        ('legacy','2026-01-03','Legacy',NULL,0,0);
      INSERT INTO activity_coach_summaries VALUES ('valid',90,'{"verdict":"on_track"}'),
        ('broken',40,'not json');
    `);
    try {
      expect(listActivitiesService(db).activities.map(activity => activity.verdict)).toEqual([
        'insufficient_evidence', 'insufficient_evidence', 'on_track'
      ]);
      expect(listActivitiesService(db, 'easy_base').activities.map(activity => activity.id)).toEqual(['valid']);
      expect(listActivitiesService(db, 'none').activities).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('falls back to the latest historical month and handles empty periods', () => {
    const db = createAggregationDatabase();
    db.prepare('INSERT INTO activities (id,start_time,max_heart_rate) VALUES (?,?,?)').run('old', '2020-02-03', 150);
    try {
      expect(getVolumeService(db, { period: 'month' }).activityCount).toBe(1);
      expect(getVolumeService(db, { period: 'week' }).activityCount).toBe(0);
      expect(getVolumeService(db, { period: 'unknown' }).periodLabel).toBe('Effort Aggregation');
    } finally {
      db.close();
    }
  });

  it('groups progress history by month and year with nullable averages and zone time', () => {
    const db = createAggregationDatabase();
    db.prepare(`INSERT INTO activities (id,start_time,name,run_type,distance_meters,duration_seconds,avg_pace_sec_km,
      avg_heart_rate,efficiency_factor,elevation_gain_m,aerobic_decoupling_pct,max_heart_rate)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('run-a', '2025-04-02', 'Easy', 'easy_base', 10000, 3600, 350, 140, 1.2, 50, 2, 160);
    db.prepare(`INSERT INTO activities (id,start_time,name,run_type,distance_meters,duration_seconds,avg_pace_sec_km,
      avg_heart_rate,efficiency_factor,elevation_gain_m,aerobic_decoupling_pct,max_heart_rate)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('run-b', '2025-04-15', 'Long', 'long_run', 0, 0, null, null, null, null, null, 160);
    db.prepare('INSERT INTO activity_records VALUES (?,?,?)').run('run-a', 0, 130);
    db.prepare('INSERT INTO activity_records VALUES (?,?,?)').run('run-a', 8, 155);
    db.prepare('INSERT INTO activity_records VALUES (?,?,?)').run('run-a', 16, null);
    db.prepare('INSERT INTO physiological_thresholds (id,effective_date,lt1_hr,is_estimated) VALUES (?,?,?,?)').run(1, '2025-04-12', 140, 1);
    try {
      const progress = getProgressHistoryService(db, 'easy');
      expect(progress.months).toHaveLength(1);
      expect(progress.months[0]).toMatchObject({ period: '2025-04', runCount: 2, totalDistanceKm: 10, avgPaceSecKm: 350, calibrations: [{ id: 1 }] });
      expect(progress.years[0]).toMatchObject({ period: '2025', activeMonths: 1, runCount: 2 });
      expect(getProgressHistoryService(db, 'threshold').months).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
