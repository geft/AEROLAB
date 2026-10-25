import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { getDatabase } from '../../src/backend/db/client.js';
import { realignDatabase } from '../../src/backend/db/realign.js';
import { updateActivityService } from '../../src/backend/services/activity-service.js';
import { detectIntervals } from '../../src/backend/ingestion/interval-detector.js';
import { classifyRun } from '../../src/backend/ingestion/classifier.js';
import { calculateEconomy } from '../../src/backend/physiology/economy.js';
import { CONFIRMED_PROFILE, CONFIRMED_RUNS } from '../fixtures/confirmed-runs.js';

describe('Athlete-confirmed historical workouts', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = getDatabase(':memory:');
    db.prepare("UPDATE athlete_profile SET max_hr=203,resting_hr=54,is_max_hr_estimated=0 WHERE id='primary'").run();
  });
  afterEach(() => db.close());

  it('keeps the November final rep together without inventing a fourth recovery', () => {
    const run = CONFIRMED_RUNS.find(r => r.date.startsWith('2025-11-27'))!;
    const work = detectIntervals(run.records, CONFIRMED_PROFILE).filter(i => i.type === 'work');
    expect(work).toHaveLength(run.expectedWorkRepCount!);
    expect(work[2].durationSeconds).toBeGreaterThan(400);
    expect(classifyRun(run.metadata, run.records, calculateEconomy(run.records),
      detectIntervals(run.records, CONFIRMED_PROFILE), CONFIRMED_PROFILE).runType).toBe('intervals_vo2');
  });

  it.each(CONFIRMED_RUNS.filter(r => r.expectedRunType === 'threshold_lt2'))('automatically retains the threshold control $date', run => {
    const intervals = detectIntervals(run.records, CONFIRMED_PROFILE);
    expect(classifyRun(run.metadata, run.records, calculateEconomy(run.records), intervals, CONFIRMED_PROFILE).runType)
      .toBe(run.expectedRunType);
  });

  it('requires sustained HR rather than isolated peaks for long VO2 reps and ignores absolute pace', () => {
    const run = CONFIRMED_RUNS.find(r => r.date.startsWith('2025-11-27'))!;
    const intervals = detectIntervals(run.records, CONFIRMED_PROFILE);
    const classify = (records: typeof run.records) => classifyRun(run.metadata, records,
      calculateEconomy(records), intervals, CONFIRMED_PROFILE).runType;
    for (const factor of [0.6, 1.5]) {
      expect(classify(run.records.map(r => ({ ...r, speedMps: (r.speedMps ?? 0) * factor,
        distanceMeters: (r.distanceMeters ?? 0) * factor })))).toBe('intervals_vo2');
    }
    const peakOnly = run.records.map(r => ({ ...r, heartRate: Math.min(r.heartRate ?? 0, 182) }));
    for (const work of intervals.filter(i => i.type === 'work')) {
      const peak = peakOnly.find(r => r.elapsedSeconds >= work.startSeconds + work.durationSeconds - 10);
      if (peak) peak.heartRate = 190;
    }
    expect(classify(peakOnly)).toBe('threshold_lt2');
    const stretched = run.records.map(r => ({ ...r, elapsedSeconds: r.elapsedSeconds * 3 }));
    expect(classifyRun({ ...run.metadata, totalDurationSeconds: run.metadata.totalDurationSeconds * 3 },
      stretched, calculateEconomy(stretched), intervals.map(i => ({ ...i,
        startSeconds: i.startSeconds * 3, durationSeconds: i.durationSeconds * 3 })), CONFIRMED_PROFILE).runType)
      .toBe('threshold_lt2');
  });

  it.each(CONFIRMED_RUNS)('retains confirmed intent and outcome through repeated replay: $date', run => {
    const meta = run.metadata;
    db.prepare(`INSERT INTO activities(id,start_time,name,sport,duration_seconds,elapsed_seconds,distance_meters,
      avg_heart_rate,max_heart_rate,avg_cadence,max_cadence,run_type,auto_run_type)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(run.id,run.date,meta.name,meta.sport,meta.totalDurationSeconds,
      meta.totalElapsedSeconds,meta.totalDistanceMeters,meta.avgHeartRate,meta.maxHeartRate,meta.avgCadence,
      meta.maxCadence,'easy_base','easy_base');
    const insert = db.prepare(`INSERT INTO activity_records(activity_id,timestamp,elapsed_seconds,heart_rate,
      cadence,speed_mps,distance_m,stance_time,vert_osc) VALUES(?,?,?,?,?,?,?,?,?)`);
    db.transaction(() => {
      for (const r of run.records) insert.run(run.id,r.timestamp,r.elapsedSeconds,r.heartRate,r.cadence,r.speedMps,
        r.distanceMeters,r.stanceTime,r.verticalOscillation);
    })();
    expect(updateActivityService(db, run.id, { run_type: run.expectedRunType }).ok).toBe(true);
    for (let replay = 0; replay < 2; replay++) {
      expect(realignDatabase(db).activitiesFailed).toEqual([]);
      expect(db.prepare('SELECT run_type,manual_run_type FROM activities WHERE id=?').get(run.id))
        .toEqual({run_type:run.expectedRunType,manual_run_type:run.expectedRunType});
    }
  });
});
