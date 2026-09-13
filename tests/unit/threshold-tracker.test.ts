import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase } from '../../src/backend/db/client.js';
import { evaluateThresholdUpdate } from '../../src/backend/physiology/threshold-tracker.js';
import { ActivityMetadata, ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';
import { EconomyMetrics } from '../../src/backend/physiology/economy.js';

describe('Threshold Tracker Unit Tests', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getDatabase(':memory:');
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


  const dummyMetadata: ActivityMetadata = {
    activityId: 'test-act-001',
    activityName: 'Test Aerobic Run',
    startTime: '2026-09-10 07:00:00',
    distanceMeters: 10000,
    durationSeconds: 3000,
    calories: 600,
    elevationGainM: 10,
    avgCadence: 175,
    avgStanceTime: 240,
    avgVerticalOscillation: 85,
    recordsCount: 600
  };

  const dummyRecords: ActivityRecord[] = [];

  it('calibrates LT1 on qualifying steady base run (< 4.5% drift, >= 30 mins)', () => {
    const economy: EconomyMetrics = {
      movingDurationSeconds: 2400, // 40 mins
      movingDistanceMeters: 7500,
      avgMovingHeartRate: 145,
      avgMovingPaceSecKm: 320,
      efficiencyFactor: 1.28,
      metersPerBeat: 3.12,
      firstHalfEf: 1.29,
      secondHalfEf: 1.26,
      aerobicDecouplingPct: 2.3 // Qualifies < 4.5%
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

    expect(estimate.lt1Hr).toBe(145);
    expect(estimate.lt1PaceSecKm).toBe(320);
    expect(estimate.lt2Hr).toBeNull();

    // Verify written to database table
    const stored = db.prepare('SELECT * FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-001') as any;
    expect(stored).toBeDefined();
    expect(stored.lt1_hr).toBe(145);
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

    // Should preserve baseline LT1 (148) and NOT depress ceiling down to 132
    expect(estimate.lt1Hr).toBe(148);
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
      dummyMetadata,
      dummyRecords,
      shortEconomy
    );
    expect(estimateShort.lt1Hr).toBeNull();

    const count = db.prepare('SELECT COUNT(*) as count FROM physiological_thresholds').get() as any;
    expect(count.count).toBe(0);
  });

  it('calibrates LT2 on threshold runs', () => {
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

    expect(estimate.lt2Hr).toBe(169);
    expect(estimate.lt2PaceSecKm).toBe(267);
    expect(estimate.lt1Hr).toBeNull();

    const stored = db.prepare('SELECT * FROM physiological_thresholds WHERE source_activity_id = ?').get('test-act-thresh') as any;
    expect(stored).toBeDefined();
    expect(stored.lt2_hr).toBe(169);
    expect(stored.lt2_pace_sec_km).toBe(267);
    expect(stored.confidence).toBe(0.85);
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
});
