import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../src/backend/db/client.js';
import { getThresholdsService } from '../../src/backend/services/thresholds-service.js';
import { computeRollingThresholds } from '../../src/backend/physiology/threshold-tracker.js';

describe('Accepted threshold evidence through SQLite and API', () => {
  let db: Database.Database;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-30T12:00:00'));
    db = openDatabase(':memory:');
    db.prepare("UPDATE athlete_profile SET max_hr=203,resting_hr=55,is_max_hr_estimated=0,lt1_min_hr=149,lt1_max_hr=151 WHERE id='primary'").run();
  });
  afterEach(() => { db.close(); vi.useRealTimers(); });

  const source = (day: number, hr: number, pace: number, type = 'easy_base') => {
    const id = `source-${day}`, date = `2026-06-${String(day).padStart(2, '0')}T12:00:00`;
    const duration = type === 'threshold_lt2' ? 3600 : pace * 8;
    db.prepare(`INSERT INTO activities(id,name,start_time,run_type,distance_meters,duration_seconds)
      VALUES(?,'Running',?,?,?,?)`).run(id, date, type, duration / pace * 1000, duration);
    const insertRecord = db.prepare(`INSERT INTO activity_records(activity_id,timestamp,elapsed_seconds,heart_rate,speed_mps,cadence)
      VALUES(?,?,?,?,?,175)`);
    const insertSplit = db.prepare(`INSERT INTO activity_splits(activity_id,split_index,distance_meters,duration_seconds,avg_pace_sec_km,avg_heart_rate,elevation_change_m)
      VALUES(?,?,1000,?,?,?,0)`);
    db.transaction(() => {
      for (let second = 0; second <= duration; second++) insertRecord.run(id,
        new Date(new Date(date).getTime() + second * 1000).toISOString(), second, hr, 1000 / pace);
      for (let split = 1; split <= 8; split++) insertSplit.run(id, split, pace, pace, hr);
    })();
    return { id, date };
  };
  const aerobic = (day: number, hr = 150, pace = 360) => {
    const run = source(day, hr, pace);
    db.prepare(`INSERT INTO physiological_thresholds(effective_date,source_activity_id,lt1_hr,lt1_pace_sec_km,confidence,notes)
      VALUES(?,?,?,?,0.9,'Calibrated Aerobic Base (LT1) from Cruising Block Km 3-8')`).run(run.date, run.id, hr, pace);
    return run;
  };

  it('holds accepted LT1 through slower easy runs, preserves history, and uses accepted dates in the API', () => {
    aerobic(1); const accepted = aerobic(2);
    aerobic(3, 144, 400); aerobic(4, 144, 400); aerobic(5, 144, 400);
    db.prepare(`INSERT INTO physiological_thresholds(effective_date,source_kind,lt2_hr,lt2_pace_sec_km,confidence)
      VALUES('2026-06-01','external',178,275,1)`).run();
    const result = getThresholdsService(db);
    expect(result.currentThresholds).toMatchObject({ lt1Hr: 150, lt1PaceSecKm: 360, lt2PaceSecKm: 275,
      lt1Evidence: { status: 'held', acceptedDate: accepted.date, supportCount: 2 } });
    expect(result.latest.lt1).toMatchObject({ effective_date: accepted.date, lt1_pace_sec_km: 360, is_estimated: true });
    expect(result.history.filter(row => row.lt1_hr != null)).toHaveLength(5);
    expect(result.history[0].lt1_pace_sec_km).toBe(400);
    expect(computeRollingThresholds(db, '2026-06-02T11:59:59').lt1PaceSecKm).toBeNull();
  });

  it('exposes lower-confidence running-only evidence without rewriting mixed observations', () => {
    for (const day of [1, 2, 3]) {
      const run = aerobic(day, 150, 400);
      db.prepare("UPDATE activity_records SET speed_mps=1.2,heart_rate=135 WHERE activity_id=? AND elapsed_seconds % 600 >= 540").run(run.id);
      db.prepare('UPDATE physiological_thresholds SET lt1_pace_sec_km=450 WHERE source_activity_id=?').run(run.id);
    }
    const result = getThresholdsService(db);
    expect(result.currentThresholds).toMatchObject({ lt1PaceSecKm: 400,
      lt1Evidence: { basis: 'run_walk', supportCount: 3 } });
    expect(result.latest.lt1).toMatchObject({ lt1_pace_sec_km: 400, confidence: 0.65 });
    expect(result.history[0]).toMatchObject({ lt1_pace_sec_km: 450, lt1_evidence_pace: 400,
      lt1_evidence_kind: 'run_walk', lt1_evidence_confidence: 0.65 });
    expect(db.prepare('SELECT DISTINCT lt1_pace_sec_km FROM physiological_thresholds').all()).toEqual([{ lt1_pace_sec_km: 450 }]);
  });

  it('rechecks failed sources and does not cache rolled-back evidence', () => {
    aerobic(1); aerobic(2);
    expect(computeRollingThresholds(db).lt1PaceSecKm).toBe(360);
    const transaction = db.transaction(() => {
      db.prepare("UPDATE activities SET manual_failed_workout=1 WHERE id='source-2'").run();
      expect(computeRollingThresholds(db).lt1PaceSecKm).toBeNull();
      throw new Error('rollback');
    });
    expect(transaction).toThrow('rollback');
    expect(computeRollingThresholds(db).lt1PaceSecKm).toBe(360);
    db.prepare("UPDATE activities SET manual_failed_workout=1 WHERE id='source-2'").run();
    expect(computeRollingThresholds(db).lt1PaceSecKm).toBeNull();
  });

  it('refuses LT1 supported only by splits when telemetry contains a walk', () => {
    aerobic(1); aerobic(2);
    db.prepare("UPDATE activity_records SET speed_mps=0.8 WHERE activity_id='source-2' AND elapsed_seconds BETWEEN 1200 AND 1260").run();
    expect(getThresholdsService(db).currentThresholds.lt1PaceSecKm).toBeNull();
  });

  it('keeps synthetic LT2 prediction fallbacks out of accepted threshold cards', () => {
    aerobic(1); aerobic(2);
    const result = getThresholdsService(db);
    expect(result.currentThresholds.lt2PaceSecKm).toBeNull();
    expect(result.latest.lt2?.lt2_pace_sec_km).toBeNull();
    expect(result.predictions.length).toBeGreaterThan(0);
    expect(result.predictionEvidence?.source).toBe('lt1');
  });

  it('requires usable threshold reps and rejects long recoveries even with two matching summaries', () => {
    for (const day of [1, 2]) {
      const run = source(day, 178, 300, 'threshold_lt2');
      const insert = db.prepare(`INSERT INTO activity_intervals(activity_id,interval_index,type,start_seconds,duration_seconds)
        VALUES(?,?,?,?,?)`);
      insert.run(run.id, 1, 'work', 600, 900);
      insert.run(run.id, 2, 'recovery', 1500, 180);
      insert.run(run.id, 3, 'work', 1680, 900);
      db.prepare(`INSERT INTO physiological_thresholds(effective_date,source_activity_id,lt2_hr,lt2_pace_sec_km,confidence)
        VALUES(?,?,178,300,0.92)`).run(run.date, run.id);
    }
    expect(computeRollingThresholds(db).lt2PaceSecKm).toBeNull();
    db.prepare("UPDATE activity_intervals SET duration_seconds=90 WHERE type='recovery'").run();
    db.prepare("UPDATE activity_intervals SET start_seconds=1590 WHERE interval_index=3").run();
    expect(computeRollingThresholds(db).lt2PaceSecKm).toBe(300);
  });
});
