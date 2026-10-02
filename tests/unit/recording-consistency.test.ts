import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/backend/db/client.js';
import { importRunContent } from '../../src/backend/ingestion/importer.js';
import { realignDatabase } from '../../src/backend/db/realign.js';
import { calculateActivityTrainingLoad } from '../../src/backend/physiology/training-load.js';
import { continuousRaceEffort } from '../../src/backend/ingestion/continuous-effort.js';
import { traceCsv, workoutTrace } from '../fixtures/workout-trace.js';

const profile = { maxHr: 190, restingHr: 50, lt1Hr: 141, lt2Hr: 165 };

describe('Observed duration across the analysis pipeline', () => {
  it.each([[1], [5], [15], [1, 15, 3, 8]])('preserves sustained threshold calibration, zones and replay with sampling %j', (...steps) => {
    const db = openDatabase(':memory:');
    try {
      db.prepare("UPDATE athlete_profile SET max_hr=190,resting_hr=50,is_max_hr_estimated=0 WHERE id='primary'").run();
      const trace = workoutTrace([{ seconds: 2400, hr: 165 }], { steps });
      expect(importRunContent(db, traceCsv(trace), 'trace.csv').runType).toBe('threshold_lt2');
      const read = () => ({
        run: db.prepare('SELECT run_type,training_load,z4_seconds FROM activities').get(),
        calibration: db.prepare('SELECT lt2_hr,lt2_pace_sec_km FROM physiological_thresholds').get()
      });
      const imported = read();
      expect(imported.run).toEqual({ run_type: 'threshold_lt2', training_load: calculateActivityTrainingLoad(trace.records, profile).trainingLoad, z4_seconds: 2400 });
      expect(imported.calibration).toEqual({ lt2_hr: 165, lt2_pace_sec_km: 333 });
      expect(realignDatabase(db).activitiesFailed).toEqual([]);
      expect(read()).toEqual(imported);
    } finally { db.close(); }
  });

  it.each([16, 60])('does not invent race evidence or zone duration across %is recording gaps', step => {
    const trace = workoutTrace([{ seconds: 2400, hr: 185 }], { steps: [step] });
    expect(continuousRaceEffort(trace.records, profile)).toBeNull();
    expect(Object.values(calculateActivityTrainingLoad(trace.records, profile).zones).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it.each([null, 250])('does not turn a long sensor dropout (%s bpm) into threshold calibration', hr => {
    const db = openDatabase(':memory:');
    try {
      db.prepare("UPDATE athlete_profile SET max_hr=190,resting_hr=50,is_max_hr_estimated=0 WHERE id='primary'").run();
      const trace = workoutTrace([
        { seconds: 600, hr: 165 }, { seconds: 1200, hr }, { seconds: 600, hr: 165 }
      ]);
      importRunContent(db, traceCsv(trace), 'dropout.csv');
      // Confirmed threshold intent does not make missing evidence a measurement.
      db.prepare("UPDATE activities SET manual_run_type='threshold_lt2',run_type='threshold_lt2'").run();
      expect(realignDatabase(db).activitiesFailed).toEqual([]);
      expect(db.prepare('SELECT COUNT(*) AS n FROM physiological_thresholds').get()).toEqual({ n: 0 });
    } finally { db.close(); }
  });

  it('counts observed load once and ignores invalid HR, duplicate and reversed clock spans', () => {
    const rows = [{ elapsedSeconds: 0, heartRate: 165 }, { elapsedSeconds: 15, heartRate: 165 },
      { elapsedSeconds: 15, heartRate: 165 }, { elapsedSeconds: 10, heartRate: 165 },
      { elapsedSeconds: 25, heartRate: 250 }, { elapsedSeconds: Number.NaN, heartRate: 165 }];
    expect(calculateActivityTrainingLoad(rows, profile).zones.z4Seconds).toBe(15);
  });
});
