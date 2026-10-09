import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../src/backend/db/client.js';
import { createMigrationRunner } from '../../src/backend/db/migrations.js';
import { runSchemaMigrations } from '../../src/backend/db/migrations/registry.js';
import { importParsedRun } from '../../src/backend/ingestion/importer.js';
import { getActivityDetailService } from '../../src/backend/services/activity-service.js';
import { syncActivityCoachSummary } from '../../src/backend/physiology/coach-summary.js';
import { calculateActivityTrainingLoad } from '../../src/backend/physiology/training-load.js';
import { getHeartRateProfileAtDate } from '../../src/backend/physiology/threshold-tracker.js';
import { workoutTrace } from '../fixtures/workout-trace.js';

describe('Treadmill analysis', () => {
  let db: Database.Database;
  beforeEach(() => { db = openDatabase(':memory:'); });
  afterEach(() => db.close());

  const seed = () => {
    const trace = workoutTrace([{ seconds: 2100, hr: 140, speed: 2.5 }], { id: 'treadmill' });
    expect(importParsedRun(db, { ...trace, fileHash: 'treadmill-hash',
      fitMetadata: { session: { sub_sport: 'treadmill' } } }, 'treadmill.fit').status).toBe('imported');
    return trace;
  };

  it('retains the source treadmill flag, omits outdoor comparisons and adds no threshold evidence', () => {
    seed();
    const detail = getActivityDetailService(db, 'treadmill');
    expect(detail?.activity.is_treadmill).toBe(true);
    expect(detail?.coachSummary?.keyInsights?.join(' ')).toContain('Treadmill session');
    expect(detail?.coachSummary?.keyInsights?.join(' ')).not.toContain('loop turnarounds');
    expect(db.prepare('SELECT COUNT(*) n FROM physiological_thresholds WHERE source_activity_id=?').get('treadmill')).toEqual({ n: 0 });
  });

  it('repairs stale zones with the same dated profile as coaching, while read-only previews do not write', () => {
    const trace = seed();
    const profile = getHeartRateProfileAtDate(db, trace.metadata.date, 'treadmill');
    const expected = calculateActivityTrainingLoad(trace.records, profile);
    db.prepare('UPDATE activities SET z3_seconds=999 WHERE id=?').run('treadmill');
    syncActivityCoachSummary(db, 'treadmill', undefined, { persist: false });
    expect(db.prepare('SELECT z3_seconds FROM activities WHERE id=?').get('treadmill')).toEqual({ z3_seconds: 999 });
    const summary = syncActivityCoachSummary(db, 'treadmill');
    expect(summary?.analysisProvenance?.historicalProfile.lt1Hr).toBe(profile.lt1Hr);
    expect(db.prepare('SELECT training_load,z1_seconds,z2_seconds,z3_seconds,z4_seconds,z5_seconds FROM activities WHERE id=?').get('treadmill')).toEqual({
      training_load: expected.trainingLoad, z1_seconds: expected.zones.z1Seconds, z2_seconds: expected.zones.z2Seconds,
      z3_seconds: expected.zones.z3Seconds, z4_seconds: expected.zones.z4Seconds, z5_seconds: expected.zones.z5Seconds
    });
  });

  it('rolls back zone updates if saving the coach summary fails', () => {
    seed();
    db.prepare('UPDATE activities SET z3_seconds=999 WHERE id=?').run('treadmill');
    db.exec("CREATE TRIGGER reject_summary BEFORE UPDATE ON activity_coach_summaries BEGIN SELECT RAISE(ABORT, 'rejected'); END");
    expect(() => syncActivityCoachSummary(db, 'treadmill')).toThrow('rejected');
    expect(db.prepare('SELECT z3_seconds FROM activities WHERE id=?').get('treadmill')).toEqual({ z3_seconds: 999 });
  });

  it('backfills existing treadmill sessions from their compressed FIT metadata', () => {
    seed();
    db.prepare("DELETE FROM schema_migrations WHERE name='activity-environment-v1'").run();
    db.exec('ALTER TABLE activities DROP COLUMN is_treadmill');
    runSchemaMigrations(db, createMigrationRunner(db));
    expect(db.prepare('SELECT is_treadmill FROM activities WHERE id=?').get('treadmill')).toEqual({ is_treadmill: 1 });
  });

  it('returns repaired zone values on the first request for stale coaching', () => {
    seed();
    db.prepare('UPDATE activities SET z3_seconds=999 WHERE id=?').run('treadmill');
    db.prepare("UPDATE activity_coach_summaries SET analysis_json='{}' WHERE activity_id=?").run('treadmill');
    const detail = getActivityDetailService(db, 'treadmill');
    expect(detail?.activity.z3_seconds).not.toBe(999);
    expect(detail?.analysisFreshness?.status).toBe('fresh');
  });
});
