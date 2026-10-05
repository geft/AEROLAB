import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/backend/db/client.js';
import { realignDatabase } from '../../src/backend/db/realign.js';
import { importParsedRun } from '../../src/backend/ingestion/importer.js';
import { analyzeWorkout, prepareAnalysisContext } from '../../src/backend/application/analysis/analyze-workout.js';
import { getHeartRateProfileAtDate, getStridePaceAnchorSecKmAtDate } from '../../src/backend/physiology/threshold-tracker.js';
import { workoutTrace } from '../fixtures/workout-trace.js';

describe('Import and replay share workout analysis', () => {
  it.each(['csv', 'fit-paused', 'fit-laps'] as const)('preserves stored analysis across %s import and repeated replay', kind => {
    const db = openDatabase(':memory:');
    try {
      db.prepare("UPDATE athlete_profile SET age=26,dob=NULL,max_hr=190,resting_hr=50,is_max_hr_estimated=1 WHERE id='primary'").run();
      const run = kind === 'fit-paused'
        ? workoutTrace([{ seconds: 300, hr: 125 }, { seconds: 700, hr: 190 }, { seconds: 200, hr: 125 }])
        : kind === 'fit-laps'
          ? workoutTrace([{ seconds: 480, hr: 170 }, { seconds: 120, hr: 135, speed: 1.5, cadence: 110 }, { seconds: 480, hr: 170 }])
          : workoutTrace([{ seconds: 2400, hr: 145 }]);
      const origin = Date.parse(run.records[0].timestamp);
      const utc = (seconds: number) => new Date(origin + seconds * 1000).toISOString();
      const fitMetadata = kind === 'fit-paused' ? { events: [
        { timestamp: utc(300), event: 'timer', event_type: 'stopAll' },
        { timestamp: utc(1000), event: 'timer', event_type: 'start' }
      ] } : kind === 'fit-laps' ? { laps: [
        { start_time: utc(0), total_elapsed_time: 480, intensity: 'active' },
        { start_time: utc(480), total_elapsed_time: 120, intensity: 'recovery' },
        { start_time: utc(600), total_elapsed_time: 480, intensity: 'active' }
      ] } : undefined;
      const raw = structuredClone(run.records);
      const expected = analyzeWorkout(prepareAnalysisContext({ metadata: run.metadata,
        rawRecords: run.records, fitMetadata,
        historicalProfile: getHeartRateProfileAtDate(db, run.metadata.date),
        stridePaceAnchorSecKm: getStridePaceAnchorSecKmAtDate(db, run.metadata.date) }));
      expect(importParsedRun(db, { ...run, fitMetadata, fileHash: kind }, `${kind}.fit`).status).toBe('imported');
      const activity = db.prepare('SELECT run_type,auto_run_type,tags,efficiency_factor,aerobic_decoupling_pct,pause_duration_seconds FROM activities').get();
      expect(activity).toEqual({ run_type: expected.runType, auto_run_type: expected.classification.runType,
        tags: JSON.stringify(expected.tags), efficiency_factor: expected.economy.efficiencyFactor,
        aerobic_decoupling_pct: expected.economy.aerobicDecouplingPct,
        pause_duration_seconds: expected.economy.pauseBreakdown?.stopDurationSeconds ?? 0 });
      expect(db.prepare('SELECT COUNT(*) count FROM activity_intervals').get()).toEqual({ count: expected.intervals.length });
      expect(db.prepare('SELECT COUNT(*) count FROM activity_splits').get()).toEqual({ count: expected.splits.length });

      const snapshot = () => ({
        activity: db.prepare(`SELECT run_type,auto_run_type,tags,efficiency_factor,aerobic_decoupling_pct,training_load,
          z1_seconds,z2_seconds,z3_seconds,z4_seconds,z5_seconds,pause_duration_seconds FROM activities`).all(),
        intervals: db.prepare('SELECT type,start_seconds,duration_seconds,avg_heart_rate FROM activity_intervals ORDER BY interval_index').all(),
        splits: db.prepare('SELECT distance_meters,duration_seconds,avg_pace_sec_km,avg_heart_rate FROM activity_splits ORDER BY split_index').all(),
        thresholds: db.prepare('SELECT effective_date,lt1_hr,lt2_hr,lt1_pace_sec_km,lt2_pace_sec_km,confidence FROM physiological_thresholds ORDER BY id').all(),
        coach: db.prepare('SELECT headline,effectiveness_score,analysis_json FROM activity_coach_summaries').all()
      });
      const imported = snapshot();
      for (let replay = 0; replay < 2; replay++) {
        expect(realignDatabase(db)).toMatchObject({ activitiesProcessed: 1, activitiesSkipped: 0, activitiesFailed: [] });
        expect(snapshot()).toEqual(imported);
      }
      expect(run.records).toEqual(raw);
      expect(db.prepare('SELECT COUNT(*) count FROM activity_records').get()).toEqual({ count: raw.length });
    } finally { db.close(); }
  });
});
