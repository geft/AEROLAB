import { seedBenchmarkProfile } from '../fixtures/benchmark-runs.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase } from '../../src/backend/db/client.js';
import { evaluateThresholdUpdate, computeRollingThresholds, getCurrentThresholds, getStridePaceAnchorSecKmAtDate } from '../../src/backend/physiology/threshold-tracker.js';
import { ActivityMetadata, ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';
import { EconomyMetrics } from '../../src/backend/physiology/economy.js';

describe('Threshold Tracker Unit Tests', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getDatabase(':memory:');
    seedBenchmarkProfile(db);
  });

  afterEach(() => {
    db.close();
  });

  const insertParentActivity = (id: string, date: string = '2026-09-10 07:00:00') => {
    db.prepare(`
      INSERT OR REPLACE INTO activities (
        id, start_time, name, run_type, distance_meters, duration_seconds, calories
      ) VALUES (?, ?, 'Test Run', 'easy_base', 10000, 3000, 600)
    `).run(id, date);
  };

  it('builds a date-specific stride pace anchor from LT2 and nearby threshold/VO2 rep paces', () => {
    const insertQualityRun = (id: string, date: string, runType: string, paces: number[]) => {
      insertParentActivity(id, date);
      db.prepare('UPDATE activities SET run_type = ? WHERE id = ?').run(runType, id);
      const insertInterval = db.prepare(`
        INSERT INTO activity_intervals (
          activity_id, interval_index, type, duration_seconds, avg_pace_sec_km
        ) VALUES (?, ?, 'work', 180, ?)
      `);
      paces.forEach((pace, index) => insertInterval.run(id, index + 1, pace));
    };

    insertQualityRun('threshold-nearby', '2026-09-01 19:00:00', 'threshold_lt2', [278, 293]);
    insertQualityRun('vo2-nearby', '2026-09-05 19:00:00', 'intervals_vo2', [231, 260, 265]);
    insertQualityRun('quality-future', '2026-09-12 19:00:00', 'intervals_vo2', [200]);
    db.prepare(`
      INSERT INTO physiological_thresholds (effective_date, source_activity_id, lt2_pace_sec_km, confidence)
      VALUES (?, ?, ?, ?)
    `).run('2026-09-07 19:00:00', 'threshold-nearby', 280, 0.9);

    expect(getStridePaceAnchorSecKmAtDate(db, '2026-09-10 19:00:00')).toBe(260);
  });


  const dummyMetadata: ActivityMetadata = {
    id: 'test-act-001',
    name: 'Test Aerobic Run',
    date: '2026-09-10 07:00:00',
    sport: 'running',
    totalDistanceMeters: 10000,
    totalDurationSeconds: 3000,
    totalElapsedSeconds: 3000,
    avgHeartRate: 140,
    maxHeartRate: 155,
    avgCadence: 175,
    maxCadence: 185,
    calories: 600,
    totalAscentMeters: 10,
    totalDescentMeters: 10
  };

  const dummyRecords: ActivityRecord[] = [];

  it.each([
    { max: 160, rest: 45, lt1: 120, lt2: 140, pace: 480 },
    { max: 210, rest: 65, lt1: 170, lt2: 190, pace: 280 }
  ])('calibrates independently for athlete LT1 $lt1', ({ max, rest, lt1, lt2, pace }) => {
    db.prepare("UPDATE athlete_profile SET max_hr = ?, resting_hr = ?, lt1_hr = ?, lt2_hr = ?, is_max_hr_estimated = 0 WHERE id = 'primary'").run(max, rest, lt1, lt2);
    insertParentActivity('individual');
    const estimate = evaluateThresholdUpdate(db, 'individual', dummyMetadata.date, 'easy_base', dummyMetadata, [], {
      movingDurationSeconds: 3000, movingDistanceMeters: 3000000 / pace,
      avgMovingHeartRate: lt1, avgMovingPaceSecKm: pace,
      efficiencyFactor: 1, metersPerBeat: 2, firstHalfEf: 1, secondHalfEf: 1,
      aerobicDecouplingPct: 0
    });
    expect(estimate.lt1Hr).toBe(lt1);
    expect(estimate.lt1PaceSecKm).toBe(pace);
    expect(getCurrentThresholds(db).lt1Hr).toBe(lt1);
  });

  it.each(['2026-09-17 19:00:00', '2026-09-19 05:00:00'])('uses effort rather than weekday or start time: %s', (date) => {
    insertParentActivity('schedule', date);
    const estimate = evaluateThresholdUpdate(db, 'schedule', date, 'easy_base', { ...dummyMetadata, date }, [], {
      movingDurationSeconds: 3000, movingDistanceMeters: 8000,
      avgMovingHeartRate: 150, avgMovingPaceSecKm: 375,
      efficiencyFactor: 1, metersPerBeat: 2, firstHalfEf: 1, secondHalfEf: 1,
      aerobicDecouplingPct: 1
    });
    expect(estimate.lt1Hr).toBe(150);
    expect(estimate.lt1PaceSecKm).toBe(375);
  });

  it('calibrates LT1 on qualifying steady base run (< 3.8% drift, >= 25 mins)', () => {
    const economy: EconomyMetrics = {
      movingDurationSeconds: 2400, // 40 mins
      movingDistanceMeters: 7500,
      avgMovingHeartRate: 148, // Reaches stimulusFloorHr
      avgMovingPaceSecKm: 320,
      efficiencyFactor: 1.28,
      metersPerBeat: 3.12,
      firstHalfEf: 1.29,
      secondHalfEf: 1.26,
      aerobicDecouplingPct: 2.3 // Qualifies < 3.8%
    };

    insertParentActivity('test-act-001');

    const estimate = evaluateThresholdUpdate(
      db,
      'test-act-001',
      '2026-09-10 07:00:00',
      'easy_base',
      dummyMetadata,
      dummyRecords,
      economy
    );

    expect(estimate.lt1Hr).toBe(148);
    expect(estimate.lt1PaceSecKm).toBe(320);
    expect(estimate.lt2Hr).toBeNull();

    // Verify written to database table
    const stored = db.prepare('SELECT * FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-001') as any;
    expect(stored).toBeDefined();
    expect(stored.lt1_hr).toBe(148);
    expect(stored.lt1_pace_sec_km).toBe(320);
    expect(stored.confidence).toBe(0.9);
    expect(stored.notes).toContain('Decoupling: 2.3%');
  });

  it('does NOT depress LT1 ceiling on light recovery/sub-LT1 base runs', () => {
    const recoveryEconomy: EconomyMetrics = {
      movingDurationSeconds: 2400,
      movingDistanceMeters: 6500,
      avgMovingHeartRate: 132, // Sub-LT1 recovery jog
      avgMovingPaceSecKm: 370,
      efficiencyFactor: 1.15,
      metersPerBeat: 2.8,
      firstHalfEf: 1.16,
      secondHalfEf: 1.14,
      aerobicDecouplingPct: 1.7
    };

    insertParentActivity('test-act-rec');

    const estimate = evaluateThresholdUpdate(
      db,
      'test-act-rec',
      '2026-09-10 07:00:00',
      'easy_base',
      dummyMetadata,
      dummyRecords,
      recoveryEconomy
    );

    // Sub-LT1 recovery jog does NOT touch the aerobic threshold and produces null
    expect(estimate.lt1Hr).toBeNull();
    expect(estimate.lt1PaceSecKm).toBeNull();

    // No row should be written to physiological_thresholds
    const stored = db.prepare('SELECT * FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-rec');
    expect(stored).toBeUndefined();
  });

  it('calibrates LT1 from sustained aerobic cruising block even when warmup is slow', () => {
    insertParentActivity('test-act-cruising', '2026-09-05 07:00:00');

    // Insert splits with slow warmup (Km 1-3) and steady cruising block (Km 4-10 @ 152 bpm)
    const insertSplit = db.prepare(`
      INSERT INTO activity_splits (
        activity_id, split_index, distance_meters, duration_seconds, avg_pace_sec_km, avg_heart_rate, split_efficiency_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Warmup: Km 1-3
    insertSplit.run('test-act-cruising', 1, 1000, 420, 420, 132, 1.10);
    insertSplit.run('test-act-cruising', 2, 1000, 410, 410, 135, 1.12);
    insertSplit.run('test-act-cruising', 3, 1000, 400, 400, 140, 1.14);

    // Steady Cruising Block: Km 4-10 (7 km, ~40 mins, 152 bpm, steady 340s pace)
    for (let k = 4; k <= 10; k++) {
      insertSplit.run('test-act-cruising', k, 1000, 340, 340, 152, 1.16);
    }

    const wholeRunEconomy: EconomyMetrics = {
      movingDurationSeconds: 3610,
      movingDistanceMeters: 10000,
      avgMovingHeartRate: 145, // Diluted by warmup!
      avgMovingPaceSecKm: 361,
      efficiencyFactor: 1.15,
      metersPerBeat: 2.8,
      firstHalfEf: 1.15,
      secondHalfEf: 1.15,
      aerobicDecouplingPct: 0.5
    };

    const estimate = evaluateThresholdUpdate(
      db,
      'test-act-cruising',
      '2026-09-05 07:00:00',
      'long_run',
      { ...dummyMetadata, id: 'test-act-cruising' },
      dummyRecords,
      wholeRunEconomy
    );

    // Should calibrate to the cruising block (152 bpm, 340 s/km) instead of the diluted 145 bpm
    expect(estimate.lt1Hr).toBe(152);
    expect(estimate.lt1PaceSecKm).toBe(340);

    const stored = db.prepare('SELECT * FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-cruising') as any;
    expect(stored).toBeDefined();
    expect(stored.lt1_hr).toBe(152);
    expect(stored.notes).toContain('Cruising Block Km 4-9'); // Stops at the first-hour boundary
  });

  it('rejects aerobic cruising candidate if splits are broken by non-contiguous gap', () => {
    insertParentActivity('test-act-non-contiguous', '2026-09-09 19:20:00');

    const insertSplit = db.prepare(`
      INSERT INTO activity_splits (
        activity_id, split_index, distance_meters, duration_seconds, avg_pace_sec_km, avg_heart_rate, elevation_change_m
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Splits 3, 4, 5, 6 (4 splits, 20 mins)
    for (let k = 3; k <= 6; k++) {
      insertSplit.run('test-act-non-contiguous', k, 1000, 360, 360, 146, 2);
    }
    // Split 7 is omitted or walking/steep hill (+170m)
    insertSplit.run('test-act-non-contiguous', 7, 1000, 530, 530, 148, 173); // Steep hill: filtered out

    // Split 8 (only 1 split, cannot bridge with 3-6)
    insertSplit.run('test-act-non-contiguous', 8, 1000, 360, 360, 146, 2);

    const wholeRunEconomy: EconomyMetrics = {
      movingDurationSeconds: 2400,
      movingDistanceMeters: 6000,
      avgMovingHeartRate: 146,
      avgMovingPaceSecKm: 400,
      efficiencyFactor: 1.15,
      metersPerBeat: 2.8,
      firstHalfEf: 1.15,
      secondHalfEf: 1.15,
      aerobicDecouplingPct: 0.5
    };

    // If contiguity was broken, segment [3,4,5,6] only has 4 km (1440s), which can qualify on its own,
    // but the window CANNOT bridge split 6 and split 8 together.
    const estimate = evaluateThresholdUpdate(
      db,
      'test-act-non-contiguous',
      '2026-09-09 19:20:00',
      'easy_base',
      { ...dummyMetadata, id: 'test-act-non-contiguous' },
      dummyRecords,
      wholeRunEconomy
    );

    // Missing opening splits mean the elapsed calibration window is unknown.
    expect(estimate.lt1Hr).toBeNull();
    const stored = db.prepare('SELECT * FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-non-contiguous') as any;
    expect(stored).toBeUndefined();
  });

  it('rejects candidate if pace drops > 10% below recent baseline', () => {
    // Seed recent baseline at 355 s/km (5:55/km) on Sep 5
    insertParentActivity('act-sep5', '2026-09-05 17:00:00');
    db.prepare(`
      INSERT INTO physiological_thresholds (
        effective_date, source_activity_id, lt1_hr, lt1_pace_sec_km, confidence
      ) VALUES ('2026-09-05 17:00:00', 'act-sep5', 152, 355, 0.92)
    `).run();

    insertParentActivity('test-act-slow-drop', '2026-09-09 19:20:00');

    const insertSplit = db.prepare(`
      INSERT INTO activity_splits (
        activity_id, split_index, distance_meters, duration_seconds, avg_pace_sec_km, avg_heart_rate, elevation_change_m
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Abnormally slow splits: 426 s/km (7:06/km), which is +71s/km slower than 355 s/km baseline
    for (let k = 3; k <= 8; k++) {
      insertSplit.run('test-act-slow-drop', k, 1000, 426, 426, 146, 2);
    }

    const wholeRunEconomy: EconomyMetrics = {
      movingDurationSeconds: 2556,
      movingDistanceMeters: 6000,
      avgMovingHeartRate: 146,
      avgMovingPaceSecKm: 426,
      efficiencyFactor: 1.15,
      metersPerBeat: 2.8,
      firstHalfEf: 1.15,
      secondHalfEf: 1.15,
      aerobicDecouplingPct: 0.1
    };

    const estimate = evaluateThresholdUpdate(
      db,
      'test-act-slow-drop',
      '2026-09-09 19:20:00',
      'easy_base',
      { ...dummyMetadata, id: 'test-act-slow-drop' },
      dummyRecords,
      wholeRunEconomy
    );

    // Rejected because 426 s/km > 355 * 1.10
    expect(estimate.lt1Hr).toBeNull();
    expect(estimate.lt1PaceSecKm).toBeNull();
  });

  it('does not replace established LT1 with a slower sub-threshold long run', () => {
    insertParentActivity('prior-lt1', '2026-09-05T17:00:00');
    db.prepare("INSERT INTO physiological_thresholds (effective_date, source_activity_id, lt1_hr, lt1_pace_sec_km, confidence) VALUES ('2026-09-05T17:00:00', 'prior-lt1', 152, 355, 0.92)").run();
    insertParentActivity('test-act-z2-long', '2026-09-19 17:40:00');

    const insertSplit = db.prepare(`
      INSERT INTO activity_splits (
        activity_id, split_index, distance_meters, duration_seconds, avg_pace_sec_km, avg_heart_rate, elevation_change_m
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    // Splits 4 to 15: 144 bpm, 403 s/km (6:43/km), steady aerobic base
    for (let k = 4; k <= 15; k++) {
      insertSplit.run('test-act-z2-long', k, 1000, 403, 403, 144, 1);
    }

    const wholeRunEconomy: EconomyMetrics = {
      movingDurationSeconds: 4836,
      movingDistanceMeters: 12000,
      avgMovingHeartRate: 144,
      avgMovingPaceSecKm: 403,
      efficiencyFactor: 1.20,
      metersPerBeat: 2.9,
      firstHalfEf: 1.22,
      secondHalfEf: 1.18,
      aerobicDecouplingPct: 3.3
    };

    const estimate = evaluateThresholdUpdate(
      db,
      'test-act-z2-long',
      '2026-09-19 17:40:00',
      'long_run',
      { ...dummyMetadata, id: 'test-act-z2-long' },
      dummyRecords,
      wholeRunEconomy
    );

    expect(estimate.lt1Hr).toBeNull();
    expect(estimate.lt1PaceSecKm).toBeNull();
    expect(getCurrentThresholds(db).lt1PaceSecKm).toBe(355);
  });

  it('does NOT calibrate LT1 when decoupling is high or duration is under 30 minutes', () => {
    // High decoupling
    const highDriftEconomy: EconomyMetrics = {
      movingDurationSeconds: 2400,
      movingDistanceMeters: 7500,
      avgMovingHeartRate: 146,
      avgMovingPaceSecKm: 320,
      efficiencyFactor: 1.15,
      metersPerBeat: 2.85,
      firstHalfEf: 1.25,
      secondHalfEf: 1.15,
      aerobicDecouplingPct: 8.0 // Fails > 4.5%
    };

    const estimateHighDrift = evaluateThresholdUpdate(
      db,
      'test-act-drift',
      '2026-09-10 07:00:00',
      'easy_base',
      dummyMetadata,
      dummyRecords,
      highDriftEconomy
    );
    expect(estimateHighDrift.lt1Hr).toBeNull();

    // Short duration (< 1800s)
    const shortEconomy: EconomyMetrics = {
      movingDurationSeconds: 1200, // 20 mins
      movingDistanceMeters: 4000,
      avgMovingHeartRate: 135,
      avgMovingPaceSecKm: 300,
      efficiencyFactor: 1.30,
      metersPerBeat: 3.2,
      firstHalfEf: 1.30,
      secondHalfEf: 1.29,
      aerobicDecouplingPct: 0.8
    };

    const estimateShort = evaluateThresholdUpdate(
      db,
      'test-act-short',
      '2026-09-10 07:00:00',
      'easy_base',
      { ...dummyMetadata, totalDurationSeconds: 1200 },
      dummyRecords,
      shortEconomy
    );
    expect(estimateShort.lt1Hr).toBeNull();

    const count = db.prepare('SELECT COUNT(*) as count FROM physiological_thresholds').get() as any;
    expect(count.count).toBe(0);
  });

  it('does not calibrate LT2 from a whole-run average without sustained evidence', () => {
    const thresholdEconomy: EconomyMetrics = {
      movingDurationSeconds: 2400,
      movingDistanceMeters: 9000,
      avgMovingHeartRate: 169,
      avgMovingPaceSecKm: 267,
      efficiencyFactor: 1.48,
      metersPerBeat: 3.74,
      firstHalfEf: 1.49,
      secondHalfEf: 1.47,
      aerobicDecouplingPct: 1.3
    };

    insertParentActivity('test-act-thresh', '2026-09-11 07:00:00');

    const estimate = evaluateThresholdUpdate(
      db,
      'test-act-thresh',
      '2026-09-11 07:00:00',
      'threshold_lt2',
      dummyMetadata,
      dummyRecords,
      thresholdEconomy
    );

    expect(estimate.lt2Hr).toBeNull();
    expect(estimate.lt2PaceSecKm).toBeNull();
    expect(estimate.lt1Hr).toBeNull();

    const stored = db.prepare('SELECT * FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-thresh') as any;
    expect(stored).toBeUndefined();
  });

  it('aggregates 30-day rolling baseline economy (EF)', () => {
    // Insert two past runs in last 30 days
    db.prepare(`
      INSERT INTO activities (
        id, start_time, name, run_type, distance_meters, duration_seconds, calories, efficiency_factor
      ) VALUES
        ('act-prev-1', '2026-09-01 07:00:00', 'Past Run 1', 'easy_base', 8000, 2400, 500, 1.20),
        ('act-prev-2', '2026-09-05 07:00:00', 'Past Run 2', 'easy_base', 10000, 3000, 650, 1.40)
    `).run();

    insertParentActivity('act-current', '2026-09-12 07:00:00');

    const currentEconomy: EconomyMetrics = {

      movingDurationSeconds: 2500,
      movingDistanceMeters: 8000,
      avgMovingHeartRate: 136,
      avgMovingPaceSecKm: 312,
      efficiencyFactor: 1.30,
      metersPerBeat: 3.20,
      firstHalfEf: 1.31,
      secondHalfEf: 1.29,
      aerobicDecouplingPct: 1.5
    };

    const estimate = evaluateThresholdUpdate(
      db,
      'act-current',
      '2026-09-12 07:00:00',
      'easy_base',
      dummyMetadata,
      dummyRecords,
      currentEconomy
    );

    // Average of 1.20 and 1.40 = 1.30
    expect(estimate.baselineEconomyEf).toBeCloseTo(1.30, 2);
  });

  describe('LT2 Interval Dynamics & Tropical Adaptation Tests', () => {
    const insertWorkInterval = (
      activityId: string,
      index: number,
      startSec: number,
      durSec: number,
      distMeters: number,
      avgHr: number,
      avgPaceSecKm: number
    ) => {
      db.prepare(`
        INSERT INTO activity_intervals (
          activity_id, interval_index, type, start_seconds, duration_seconds, distance_meters, avg_heart_rate, avg_pace_sec_km
        ) VALUES (?, ?, 'work', ?, ?, ?, ?, ?)
      `).run(activityId, index, startSec, durSec, distMeters, avgHr, avgPaceSecKm);
    };

    const insertRecoveryInterval = (
      activityId: string,
      index: number,
      durSec: number,
      hrDrop: number
    ) => {
      db.prepare(`
        INSERT INTO activity_intervals (
          activity_id, interval_index, type, duration_seconds, hr_drop
        ) VALUES (?, ?, 'recovery', ?, ?)
      `).run(activityId, index, durSec, hrDrop);
    };

    it('strips acceleration ramp (first 10-12s) when work interval starts from standing/walking (< 2.2 m/s)', () => {
      insertParentActivity('test-act-ramp', '2026-09-10 19:00:00');

      // 1 sustained work interval: 1200 seconds.
      // Raw average pace without trimming would be ~283 s/km.
      // Cruising speed is 3.5714 m/s (280 s/km = 4:40/km).
      insertWorkInterval('test-act-ramp', 1, 0, 1200, 4240, 172, 283);

      // Insert records for the 600 seconds
      const insertRec = db.prepare(`
        INSERT INTO activity_records (activity_id, timestamp, elapsed_seconds, speed_mps, heart_rate)
        VALUES (?, '2026-09-10 19:00:00', ?, ?, ?)
      `);

      for (let t = 0; t <= 1200; t++) {
        if (t < 12) {
          // Standing start accelerating: 0.5 m/s to 2.0 m/s
          insertRec.run('test-act-ramp', t, 0.5 + (t / 12) * 1.5, 140 + t * 2);
        } else {
          // Cruising at 3.5714 m/s (4:40/km) and 172 bpm
          insertRec.run('test-act-ramp', t, 3.5714, 172);
        }
      }

      const economy: EconomyMetrics = {
        movingDurationSeconds: 600,
        movingDistanceMeters: 2120,
        avgMovingHeartRate: 172,
        avgMovingPaceSecKm: 283,
        efficiencyFactor: 1.45,
        metersPerBeat: 3.4,
        firstHalfEf: 1.45,
        secondHalfEf: 1.45,
        aerobicDecouplingPct: 0.5
      };

      const estimate = evaluateThresholdUpdate(
        db,
        'test-act-ramp',
        '2026-09-10 19:00:00',
        'threshold_lt2',
        { ...dummyMetadata, id: 'test-act-ramp', totalDurationSeconds: 1200 },
        [],
        economy
      );

      // Trimming the first 12s standing start yields steady cruising pace of 280 s/km (4:40/km)
      expect(estimate.lt2PaceSecKm).toBe(280);
      expect(estimate.lt2Hr).toBe(172);

      const stored = db.prepare('SELECT * FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-ramp') as any;
      expect(stored).toBeDefined();
      expect(stored.lt2_pace_sec_km).toBe(280);
      expect(stored.lt2_hr).toBe(172);
    });

    it('caps quality work evaluation to the first 30 minutes to prevent tropical hyperthermia drift', () => {
      insertParentActivity('test-act-tropical', '2026-09-17 19:00:00');

      // 3 x 15-minute reps (900s each = 2700s total work)
      // Rep 1 (900s): 178 bpm, 4:35/km (3272m)
      // Rep 2 (900s): 180 bpm, 4:35/km (3272m)
      // Rep 3 (900s): 191 bpm (tropical heat accumulation & drift!), 4:35/km (3272m)
      insertWorkInterval('test-act-tropical', 1, 0, 900, 3272, 178, 275);
      insertRecoveryInterval('test-act-tropical', 2, 90, 33);
      insertWorkInterval('test-act-tropical', 3, 990, 900, 3272, 180, 275);
      insertRecoveryInterval('test-act-tropical', 4, 90, 33);
      insertWorkInterval('test-act-tropical', 5, 1980, 900, 3272, 191, 275);

      const economy: EconomyMetrics = {
        movingDurationSeconds: 2700,
        movingDistanceMeters: 9816,
        avgMovingHeartRate: 183,
        avgMovingPaceSecKm: 275,
        efficiencyFactor: 1.48,
        metersPerBeat: 3.5,
        firstHalfEf: 1.52,
        secondHalfEf: 1.44,
        aerobicDecouplingPct: 5.5
      };

      const estimate = evaluateThresholdUpdate(
        db,
        'test-act-tropical',
        '2026-09-17 19:00:00',
        'threshold_lt2',
        { ...dummyMetadata, id: 'test-act-tropical', totalDurationSeconds: 2880 },
        [],
        economy
      );

      // Max work evaluation window is 1800s (first 30 minutes).
      // Rep 1 (900s @ 178 bpm) + Rep 2 (900s @ 180 bpm) = 1800s.
      // Rep 3 (191 bpm drift) is completely excluded.
      // Average HR = (178 * 900 + 180 * 900) / 1800 = 179 bpm!
      expect(estimate.lt2Hr).toBe(179);
      expect(estimate.lt2PaceSecKm).toBe(275);

      const stored = db.prepare('SELECT * FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-tropical') as any;
      expect(stored.lt2_hr).toBe(179);
      expect(stored.lt2_pace_sec_km).toBe(275);
    });

    it('compensates for cardiac lag and scales confidence continuously based on rest continuity', () => {
      // Session A: 90s short recovery rest (high continuity)
      insertParentActivity('test-act-short-rest', '2026-09-17 19:00:00');
      insertWorkInterval('test-act-short-rest', 1, 0, 900, 3272, 178, 275);
      insertRecoveryInterval('test-act-short-rest', 2, 90, 33);
      insertWorkInterval('test-act-short-rest', 3, 990, 900, 3272, 180, 275);

      const _estimateA = evaluateThresholdUpdate(
        db,
        'test-act-short-rest',
        '2026-09-17 19:00:00',
        'threshold_lt2',
        { ...dummyMetadata, id: 'test-act-short-rest' },
        [],
        {
          movingDurationSeconds: 1800,
          movingDistanceMeters: 6544,
          avgMovingHeartRate: 179,
          avgMovingPaceSecKm: 275,
          efficiencyFactor: 1.5,
          metersPerBeat: 3.5,
          firstHalfEf: 1.5,
          secondHalfEf: 1.5,
          aerobicDecouplingPct: 1.0
        }
      );

      // Session B: 160s long recovery rest (low continuity, deep drop)
      insertParentActivity('test-act-long-rest', '2026-09-10 19:00:00');
      insertWorkInterval('test-act-long-rest', 1, 0, 600, 2140, 172, 280);
      insertRecoveryInterval('test-act-long-rest', 2, 160, 54);
      insertWorkInterval('test-act-long-rest', 3, 760, 600, 2140, 172, 280);

      const _estimateB = evaluateThresholdUpdate(
        db,
        'test-act-long-rest',
        '2026-09-10 19:00:00',
        'threshold_lt2',
        { ...dummyMetadata, id: 'test-act-long-rest' },
        [],
        {
          movingDurationSeconds: 1200,
          movingDistanceMeters: 4280,
          avgMovingHeartRate: 172,
          avgMovingPaceSecKm: 280,
          efficiencyFactor: 1.45,
          metersPerBeat: 3.4,
          firstHalfEf: 1.45,
          secondHalfEf: 1.45,
          aerobicDecouplingPct: 1.0
        }
      );

      const storedA = db.prepare('SELECT confidence FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-short-rest') as any;
      const storedB = db.prepare('SELECT confidence FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-long-rest') as any;

      // Short rest session has higher confidence than long rest session
      expect(storedA.confidence).toBeGreaterThanOrEqual(0.90);
      expect(storedB.confidence).toBeLessThanOrEqual(0.87);
      expect(storedA.confidence).toBeGreaterThan(storedB.confidence);
    });

    it('filters out work intervals below the physiological stimulus floor', () => {
      // Set athlete profile LT2 HR to 179 bpm -> stimulus floor is 179 - 10 = 169 bpm
      db.prepare(`
        INSERT OR REPLACE INTO athlete_profile (id, lt2_hr) VALUES ('primary', 179)
      `).run();

      insertParentActivity('test-act-subfloor', '2026-09-12 19:00:00');
      // Sub-stimulus intervals (e.g. marathon pace / tempo @ 158 bpm)
      insertWorkInterval('test-act-subfloor', 1, 0, 600, 2000, 158, 300);
      insertRecoveryInterval('test-act-subfloor', 2, 120, 25);
      insertWorkInterval('test-act-subfloor', 3, 720, 600, 2000, 159, 300);

      const estimate = evaluateThresholdUpdate(
        db,
        'test-act-subfloor',
        '2026-09-12 19:00:00',
        'threshold_lt2',
        { ...dummyMetadata, id: 'test-act-subfloor' },
        [],
        {
          movingDurationSeconds: 1200,
          movingDistanceMeters: 4000,
          avgMovingHeartRate: 158,
          avgMovingPaceSecKm: 300,
          efficiencyFactor: 1.4,
          metersPerBeat: 3.3,
          firstHalfEf: 1.4,
          secondHalfEf: 1.4,
          aerobicDecouplingPct: 1.0
        }
      );

      // Should be rejected because it never approached the LT2 stimulus floor
      expect(estimate.lt2Hr).toBeNull();
      expect(estimate.lt2PaceSecKm).toBeNull();

      const stored = db.prepare('SELECT * FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-subfloor');
      expect(stored).toBeUndefined();
    });
  });

  describe('Rolling Weighted Threshold Aggregation Engine', () => {
    it('smooths LT2 across multiple sessions with differing rest protocols (e.g. Sept 10 vs Sept 17)', () => {
      insertParentActivity('act-sep10', '2026-09-10 19:30:00');
      insertParentActivity('act-sep17', '2026-09-17 19:30:00');

      // Insert Sept 10 calibration: 172 bpm @ 280 s/km (4:40/km) with long rest (confidence: 0.84)
      db.prepare(`
        INSERT INTO physiological_thresholds (
          effective_date, source_activity_id, lt2_hr, lt2_pace_sec_km, confidence, notes
        ) VALUES ('2026-09-10 19:30:00', 'act-sep10', 172, 280, 0.84, 'Long rest threshold')
      `).run();

      // Insert Sept 17 calibration: 179 bpm @ 275 s/km (4:35/km) with tight 90s rest (confidence: 0.90)
      db.prepare(`
        INSERT INTO physiological_thresholds (
          effective_date, source_activity_id, lt2_hr, lt2_pace_sec_km, confidence, notes
        ) VALUES ('2026-09-17 19:30:00', 'act-sep17', 179, 275, 0.90, 'Tight rest threshold')
      `).run();

      const rolling = computeRollingThresholds(db, '2026-09-18 10:00:00');

      // Rather than abruptly jumping between 172 bpm or 179 bpm, the rolling weighted baseline
      // smoothly resolves to ~176 bpm and 277 s/km (4:37/km)
      expect(rolling.lt2Hr).toBe(176);
      expect(rolling.lt2PaceSecKm).toBe(277);
      expect(rolling.lt2Confidence).toBeGreaterThanOrEqual(0.87);

      const current = getCurrentThresholds(db);
      expect(current.lt2Hr).toBe(176);
      expect(current.lt2PaceSecKm).toBe(277);
    });

    it('exposes the latest LT1-calibrated baseline EF so the Profile EF tile is never blank', () => {
      insertParentActivity('act-ef-lt1', '2026-08-29 16:45:00');
      insertParentActivity('act-ef-lt2', '2026-09-17 19:30:00');

      db.prepare(`
        INSERT INTO physiological_thresholds (
          effective_date, source_activity_id, lt1_hr, lt1_pace_sec_km, baseline_economy_ef, confidence, notes
        ) VALUES ('2026-08-29 16:45:00', 'act-ef-lt1', 152, 359, 1.1499, 0.86, 'Aerobic base calibration')
      `).run();

      // Newer LT2-only calibration also carries its own economy reading
      db.prepare(`
        INSERT INTO physiological_thresholds (
          effective_date, source_activity_id, lt2_hr, lt2_pace_sec_km, baseline_economy_ef, confidence, notes
        ) VALUES ('2026-09-17 19:30:00', 'act-ef-lt2', 179, 275, 1.1566, 0.91, 'Lactate threshold calibration')
      `).run();

      // Mirrors the "Efficiency Factor" benchmark tile rendered in Progress & Stats
      expect(getCurrentThresholds(db).baselineEconomyEf).toBeCloseTo(1.1499, 4);
    });

    it('reports a null baseline EF when no calibration has recorded one yet', () => {
      expect(getCurrentThresholds(db).baselineEconomyEf).toBeNull();
    });

    it('applies recency decay factor prioritizing newer sessions over older sessions', () => {
      insertParentActivity('act-old', '2026-08-05 07:00:00');
      insertParentActivity('act-recent', '2026-09-12 07:00:00');

      // Session 1: 40 days ago (high recency decay -> low weight)
      db.prepare(`
        INSERT INTO physiological_thresholds (
          effective_date, source_activity_id, lt2_hr, lt2_pace_sec_km, confidence
        ) VALUES ('2026-08-05 07:00:00', 'act-old', 170, 290, 0.90)
      `).run();

      // Session 2: 2 days ago (fresh -> full weight)
      db.prepare(`
        INSERT INTO physiological_thresholds (
          effective_date, source_activity_id, lt2_hr, lt2_pace_sec_km, confidence
        ) VALUES ('2026-09-12 07:00:00', 'act-recent', 180, 270, 0.90)
      `).run();

      const rolling = computeRollingThresholds(db, '2026-09-14 07:00:00');

      // The recent session at 180 bpm should dominate over the 40-day-old session at 170 bpm
      expect(rolling.lt2Hr).toBeGreaterThanOrEqual(177);
      expect(rolling.lt2PaceSecKm).toBeLessThanOrEqual(275);
    });

    it('smooths LT1 aerobic base across multiple cruising blocks', () => {
      insertParentActivity('act-lr1', '2026-08-25 07:00:00');
      insertParentActivity('act-lr2', '2026-09-05 07:00:00');

      // Long run 1: 151 bpm @ 371 s/km (6:11/km), conf: 0.90
      db.prepare(`
        INSERT INTO physiological_thresholds (
          effective_date, source_activity_id, lt1_hr, lt1_pace_sec_km, confidence
        ) VALUES ('2026-08-25 07:00:00', 'act-lr1', 151, 371, 0.90)
      `).run();

      // Long run 2: 152 bpm @ 355 s/km (5:55/km), conf: 0.92
      db.prepare(`
        INSERT INTO physiological_thresholds (
          effective_date, source_activity_id, lt1_hr, lt1_pace_sec_km, confidence
        ) VALUES ('2026-09-05 07:00:00', 'act-lr2', 152, 355, 0.92)
      `).run();

      const rolling = computeRollingThresholds(db, '2026-09-06 07:00:00');
      expect(rolling.lt1Hr).toBe(152);
      expect(rolling.lt1PaceSecKm).toBeCloseTo(362, -1);
      expect(rolling.lt1Confidence).toBeGreaterThanOrEqual(0.90);
    });
  });
});
