import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../src/backend/db/client.js';
import { getAerobicAssessment } from '../../src/backend/physiology/aerobic-assessment.js';
import { getThresholdsService } from '../../src/backend/services/thresholds-service.js';
import { getHeartRateProfileAtDate } from '../../src/backend/physiology/threshold-tracker.js';
import { refreshHeartRateAnalysis, refreshRecentHeartRateAnalysis } from '../../src/backend/physiology/refresh-heart-rate-analysis.js';
import { ANALYSIS_REVISION } from '../../src/shared/analysis-revision.js';

describe('Aerobic reassessment through SQLite and API', () => {
  let db: Database.Database;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-30T12:00:00Z'));
    db = openDatabase(':memory:');
  });
  afterEach(() => { db.close(); vi.useRealTimers(); });
  const source = (id: string, date: string, hr = 157, type = 'long_run') => {
    db.prepare(`INSERT INTO activities(id,start_time,sport,run_type,duration_seconds,distance_meters)
      VALUES(?,?,'running',?,4800,13793)`).run(id, date, type);
    const insert = db.prepare(`INSERT INTO activity_records(activity_id,timestamp,elapsed_seconds,heart_rate,speed_mps)
      VALUES(?,?,?,?,?)`);
    db.transaction(() => {
      for (let second = 0; second <= 4800; second += 5)
        insert.run(id, new Date(new Date(date).getTime() + second * 1000).toISOString(), second, hr, 1000 / 348);
    })();
  };
  it('promotes long and tempo evidence to working zones without writing during an API read', () => {
    db.prepare("UPDATE athlete_profile SET lt1_min_hr=147,lt1_max_hr=153 WHERE id='primary'").run();
    source('a', '2026-08-01'); source('b', '2026-08-08'); source('c', '2026-08-15', 157, 'tempo');
    const changes = () => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const before = changes();
    const result = getThresholdsService(db);
    expect(result.currentThresholds.lt1Assessment).toMatchObject({ assessedRunCount: 3, usableRunCount: 3,
      reference: { hr: 157, supportCount: 3 }, candidate: null });
    expect(result.currentThresholds).toMatchObject({ lt1Hr: 157, lt1Range: [157, 157], lt1PaceSecKm: 348,
      lt1Evidence: { method: 'aerobic_reference', supportCount: 3 } });
    expect(result.zones.z2[1]).toBe(157);
    expect(result.zones.z3[0]).toBe(158);
    expect(changes()).toBe(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM physiological_thresholds').get()).toEqual({ n: 0 });
    db.prepare("UPDATE athlete_profile SET lt1_hr=157,lt1_min_hr=157,lt1_max_hr=157 WHERE id='primary'").run();
    expect(getThresholdsService(db).currentThresholds).toMatchObject({ lt1Hr: 157, lt1PaceSecKm: 348,
      lt1Evidence: { method: 'aerobic_reference', supportCount: 3 } });
  });
  it('updates historical coaching only after corroboration and excludes the workout itself', () => {
    source('a', '2026-08-01'); source('b', '2026-08-08'); source('c', '2026-08-15');
    const before = getHeartRateProfileAtDate(db, '2026-08-14').lt1Hr;
    expect(getHeartRateProfileAtDate(db, '2026-08-15', 'c').lt1Hr).toBe(before);
    expect(getHeartRateProfileAtDate(db, '2026-08-16').lt1Hr).toBe(157);
    db.prepare("UPDATE athlete_profile SET lt1_hr=157,lt1_min_hr=157,lt1_max_hr=157 WHERE id='primary'").run();
    expect(getHeartRateProfileAtDate(db, '2026-08-14').lt1Hr).toBe(before);
  });
  it('excludes future sources and invalidates cached evidence when an activity changes', () => {
    source('a', '2026-08-01'); source('b', '2026-08-08'); source('c', '2026-08-15');
    source('future', '2026-09-01', 165, 'tempo');
    const asOf = '2026-08-30T12:00:00Z';
    expect(getAerobicAssessment(db, asOf)).toMatchObject({ assessedRunCount: 3, reference: { supportCount: 3 } });
    db.prepare("UPDATE activities SET is_treadmill=1 WHERE id='c'").run();
    expect(getAerobicAssessment(db, asOf)).toMatchObject({ assessedRunCount: 2, reference: null });
    expect(getAerobicAssessment(db, '2026-08-02').usableRunCount).toBe(1);
  });
  it('does not retain evidence computed inside a rolled-back transaction', () => {
    source('a', '2026-08-01'); source('b', '2026-08-08'); source('c', '2026-08-15');
    const asOf = '2026-08-30';
    expect(getAerobicAssessment(db, asOf).reference?.supportCount).toBe(3);
    expect(db.transaction(() => {
      db.prepare("DELETE FROM activities WHERE id='c'").run();
      expect(getAerobicAssessment(db, asOf).reference).toBeNull();
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(getAerobicAssessment(db, asOf).reference?.supportCount).toBe(3);
  });
  it('refreshes stored zones and verdicts using preceding evidence without relabeling workouts', () => {
    db.prepare("UPDATE athlete_profile SET age=37,resting_hr=54 WHERE id='primary'").run();
    source('a', '2026-08-01'); source('b', '2026-08-08'); source('c', '2026-08-15');
    source('later', '2026-08-22');
    const before = getHeartRateProfileAtDate(db, '2026-08-15', 'c').lt1Hr;
    const prepare = vi.spyOn(db, 'prepare');
    expect(refreshHeartRateAnalysis(db, ['c', 'later'])).toBe(2);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("SELECT id, start_time FROM activities WHERE sport"))).toHaveLength(1);
    prepare.mockRestore();
    for (const [id, expected] of [['c', before], ['later', 157]] as const) {
      const summary = db.prepare('SELECT analysis_json FROM activity_coach_summaries WHERE activity_id=?').get(id) as { analysis_json: string };
      expect(JSON.parse(summary.analysis_json)).toMatchObject({ revision: ANALYSIS_REVISION,
        provenance: { historicalProfile: { lt1Hr: expected } } });
      expect(db.prepare('SELECT run_type FROM activities WHERE id=?').get(id)).toEqual({ run_type: 'long_run' });
    }
    expect(db.prepare("SELECT z2_seconds FROM activities WHERE id='later'").get()).toEqual({ z2_seconds: 4800 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM activity_coach_summaries WHERE activity_id IN ('a','b')").get()).toEqual({ n: 0 });
  });
  it('automatically refreshes only the preceding 180 days, excluding future runs', () => {
    source('old', '2026-01-01'); source('recent', '2026-08-01'); source('future', '2026-09-01');
    expect(refreshRecentHeartRateAnalysis(db)).toBe(1);
    expect(db.prepare('SELECT activity_id FROM activity_coach_summaries').all()).toEqual([{ activity_id: 'recent' }]);
  });
});
