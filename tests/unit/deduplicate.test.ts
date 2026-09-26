import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase } from '../../src/backend/db/client';
import { deduplicateRuns } from '../../src/backend/db/deduplicate';

describe('Activity Deduplication Migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('detects and purges duplicate activities with matching start times and distance', () => {
    // Insert Run A (Garmin CSV style: numeric ID, custom name)
    db.prepare(`
      INSERT INTO activities (
        id, name, sport, start_time, duration_seconds, distance_meters,
        avg_heart_rate, run_type, source_file_hash, workout_lat, workout_lon
      ) VALUES (
        '24309364037', 'Singapore - Threshold', 'running', '2026-09-10 19:25:42',
        4932, 14686.15, 150, 'threshold_lt2', 'hash_csv_123', 1.332, 103.851
      )
    `).run();

    // Insert records for Run A
    db.prepare(`
      INSERT INTO activity_records (activity_id, elapsed_seconds, timestamp, heart_rate, speed_mps, distance_m)
      VALUES ('24309364037', 1, '2026-09-10 19:25:43', 130, 2.9, 2.9)
    `).run();

    // Insert Run B (FIT style: synthetic ID, default name, same start time and distance)
    db.prepare(`
      INSERT INTO activities (
        id, name, sport, start_time, duration_seconds, distance_meters,
        avg_heart_rate, run_type, source_file_hash
      ) VALUES (
        'garmin_3611393439_1157973942', 'Singapore Running', 'running', '2026-09-10 19:25:42',
        4932, 14686.15, 150, 'threshold_lt2', 'hash_fit_456'
      )
    `).run();

    // Insert records for Run B
    db.prepare(`
      INSERT INTO activity_records (activity_id, elapsed_seconds, timestamp, heart_rate, speed_mps, distance_m)
      VALUES ('garmin_3611393439_1157973942', 1, '2026-09-10 19:25:43', 130, 2.9, 2.9)
    `).run();

    const countBefore = (db.prepare('SELECT count(*) as c FROM activities').get() as any).c;
    expect(countBefore).toBe(2);

    // Run deduplication
    const result = deduplicateRuns(db);
    expect(result.pairsFound).toBe(1);
    expect(result.activitiesPurged).toBe(1);
    expect(result.purgedIds).toContain('garmin_3611393439_1157973942');

    // Verify keeper
    const remaining = db.prepare('SELECT * FROM activities').all() as any[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('24309364037');
    expect(remaining[0].name).toBe('Singapore - Threshold');
    expect(remaining[0].workout_lat).toBeCloseTo(1.332, 3);

    // Verify child table records for purged activity are deleted
    const purgedRecords = db.prepare('SELECT count(*) as c FROM activity_records WHERE activity_id = ?').get('garmin_3611393439_1157973942') as any;
    expect(purgedRecords.c).toBe(0);
  });

  it('keeps a custom title when it belongs to the second activity', () => {
    db.prepare(`
      INSERT INTO activities (id, name, sport, start_time, duration_seconds, distance_meters, avg_heart_rate)
      VALUES ('fit_1', 'Running', 'running', '2026-09-10 19:25:42', 1800, 5000, 145),
             ('garmin_2', 'Evening Tempo', 'running', '2026-09-10 19:26:20', 1800, 5050, 146)
    `).run();
    db.prepare(`INSERT INTO activity_records (activity_id, elapsed_seconds, timestamp, heart_rate, speed_mps, distance_m)
      VALUES ('fit_1', 1, '2026-09-10 19:25:43', 130, 2.9, 2.9)`).run();

    const result = deduplicateRuns(db);

    expect(result.purgedIds).toEqual(['fit_1']);
    expect(db.prepare('SELECT id, name FROM activities').get()).toEqual({ id: 'garmin_2', name: 'Evening Tempo' });
  });

  it('uses record richness before ID type when neither name is custom', () => {
    db.prepare(`
      INSERT INTO activities (id, name, sport, start_time, duration_seconds, distance_meters)
      VALUES ('10001', 'Running', 'running', '2026-09-10 19:25:42', 1800, 5000),
             ('fit_2', 'Singapore Running', 'running', '2026-09-10 19:25:42', 1800, 5000)
    `).run();
    db.prepare(`INSERT INTO activity_records (activity_id, elapsed_seconds, timestamp, heart_rate, speed_mps, distance_m)
      VALUES ('fit_2', 1, '2026-09-10 19:25:43', 130, 2.9, 2.9)`).run();

    const result = deduplicateRuns(db);

    expect(result.purgedIds).toEqual(['10001']);
    expect(db.prepare('SELECT id FROM activities').get()).toEqual({ id: 'fit_2' });
  });

  it('uses the numeric ID when default-named activities have equal record counts', () => {
    db.prepare(`
      INSERT INTO activities (id, name, sport, start_time, duration_seconds, distance_meters)
      VALUES ('10002', 'Singapore Running', 'running', '2026-09-10 19:25:42', 1800, 5000),
             ('fit_3', 'Running', 'running', '2026-09-10 19:25:42', 1800, 5000)
    `).run();

    const result = deduplicateRuns(db);

    expect(result.purgedIds).toEqual(['fit_3']);
    expect(db.prepare('SELECT id FROM activities').get()).toEqual({ id: '10002' });
  });

  it('returns an empty result with no matching runs and reports database failures', () => {
    const empty = deduplicateRuns(db);
    expect(empty).toEqual({ pairsFound: 0, activitiesPurged: 0, purgedIds: [] });

    const messages: string[] = [];
    const brokenDb = { prepare: () => { throw new Error('database unavailable'); } } as unknown as Database.Database;
    const failed = deduplicateRuns(brokenDb, message => messages.push(message));
    expect(failed.activitiesPurged).toBe(0);
    expect(messages).toContain('Deduplication error: database unavailable');
  });
});
