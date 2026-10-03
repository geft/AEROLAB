import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/backend/db/client.js';
import { importParsedRun } from '../../src/backend/ingestion/importer.js';
import { realignDatabase } from '../../src/backend/db/realign.js';
import { workoutTrace } from '../fixtures/workout-trace.js';
import { seedBenchmarkProfile } from '../fixtures/benchmark-runs.js';

describe('FIT-aware import and replay', () => {
  it('preserves raw stopped HR while replay keeps explicit pause totals and classification', () => {
    const db = openDatabase(':memory:');
    try {
      seedBenchmarkProfile(db, { datedThresholds: true });
      db.prepare("UPDATE physiological_thresholds SET effective_date='2026-01-01 00:00:00' WHERE source_kind='external'").run();
      const run = workoutTrace([{ seconds: 300, hr: 125 }, { seconds: 700, hr: 190 }, { seconds: 200, hr: 125 }]);
      const utc = (seconds: number) => new Date(Date.parse('2026-02-02T12:00:00Z') + seconds * 1000).toISOString();
      run.records.forEach(record => { record.timestamp = utc(record.elapsedSeconds).replace('Z', ''); });
      const fitMetadata = { utcOffsetSeconds: 0, events: [
        { timestamp: utc(300), event: 'timer', event_type: 'stopAll' },
        { timestamp: utc(1000), event: 'timer', event_type: 'start' }
      ] };
      expect(importParsedRun(db, { ...run, fileHash: 'paused-fit', fitMetadata }, 'paused.fit').status).toBe('imported');
      const read = () => db.prepare('SELECT auto_run_type,pause_duration_seconds FROM activities').get();
      expect(read()).toEqual({ auto_run_type: 'recovery', pause_duration_seconds: 700 });
      expect(realignDatabase(db).activitiesFailed).toEqual([]);
      expect(read()).toEqual({ auto_run_type: 'recovery', pause_duration_seconds: 700 });
      expect(db.prepare('SELECT heart_rate FROM activity_records WHERE elapsed_seconds=600').get()).toEqual({ heart_rate: 190 });
    } finally { db.close(); }
  });
  it('replays identical lap intervals and measured dynamics while preserving raw paused records and manual labels', () => {
    const db = openDatabase(':memory:');
    try {
      seedBenchmarkProfile(db, { datedThresholds: true });
      db.prepare("UPDATE physiological_thresholds SET effective_date='2026-01-01 00:00:00' WHERE source_kind='external'").run();
      const run = workoutTrace([{ seconds: 480, hr: 170 }, { seconds: 120, hr: 170 }, { seconds: 480, hr: 170 }]);
      const utc = (seconds: number) => new Date(Date.parse('2026-02-02T12:00:00Z') + seconds * 1000).toISOString();
      run.records.forEach(record => { record.timestamp = utc(record.elapsedSeconds).replace('Z', ''); record.stepLength = 1.23; record.verticalRatio = 6.4; });
      const fitMetadata = { utcOffsetSeconds: 0, laps: [
        { start_time: utc(0), total_elapsed_time: 480, intensity: 'active' },
        { start_time: utc(480), total_elapsed_time: 120, intensity: 'recovery' },
        { start_time: utc(600), total_elapsed_time: 480, intensity: 'active' }
      ], events: [{ timestamp: utc(0), event: 'timer', event_type: 'start' }, { timestamp: utc(1080), event: 'timer', event_type: 'stopAll' }] };
      expect(importParsedRun(db, { ...run, fileHash: 'fit-analysis', fitMetadata }, 'structure.fit').status).toBe('imported');
      const read = () => db.prepare('SELECT type,start_seconds,duration_seconds,avg_step_length,avg_vert_ratio FROM activity_intervals ORDER BY interval_index').all();
      const imported = read();
      expect(imported.filter((interval: any) => interval.type === 'work')).toHaveLength(2);
      expect(imported[0]).toMatchObject({ avg_step_length: 1.23, avg_vert_ratio: 6.4 });
      db.prepare("UPDATE activities SET manual_run_type='easy_base',run_type='easy_base' WHERE id=?").run(run.metadata.id);
      expect(realignDatabase(db).activitiesFailed).toEqual([]);
      expect(read()).toEqual(imported);
      expect(db.prepare('SELECT run_type FROM activities WHERE id=?').get(run.metadata.id)).toEqual({ run_type: 'easy_base' });
      expect(db.prepare('SELECT COUNT(*) count FROM activity_records').get()).toEqual({ count: run.records.length });
      expect(realignDatabase(db).activitiesFailed).toEqual([]);
      expect(read()).toEqual(imported);
    } finally { db.close(); }
  });
});
