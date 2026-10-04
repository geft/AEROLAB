import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../src/backend/db/client.js';
import { realignDatabase } from '../../src/backend/db/realign.js';
import { importRunContent, importParsedRuns } from '../../src/backend/ingestion/importer.js';
import { parseRunCSV } from '../../src/backend/ingestion/csv-parser.js';
import { getHeartRateProfileAtDate } from '../../src/backend/physiology/threshold-tracker.js';
import { getVolumeService } from '../../src/backend/services/activity-service.js';
import { recomputeProfileDerivedData } from '../../src/backend/physiology/profile-recompute.js';
import { getStridePaceAnchorSecKmAtDate } from '../../src/backend/physiology/threshold-tracker.js';
import { syncActivityCoachSummary } from '../../src/backend/physiology/coach-summary.js';
import { traceCsv, workoutTrace } from '../fixtures/workout-trace.js';

describe('Historical fitness with stable athlete max HR', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDatabase(':memory:');
    db.prepare("UPDATE athlete_profile SET max_hr=190,resting_hr=50,is_max_hr_estimated=0 WHERE id='primary'").run();
  });
  afterEach(() => { db.close(); });

  const measurement = (date: string, lt1: number, lt2: number, confidence = 0.95) =>
    db.prepare(`INSERT INTO physiological_thresholds(effective_date,source_kind,lt1_hr,lt2_hr,confidence)
      VALUES(?,'external',?,?,?)`).run(date, lt1, lt2, confidence);
  const importSteady = (id: string, date: string, hr = 155) => {
    const trace = workoutTrace([{ seconds: 2400, hr }], { id, date });
    const result = importRunContent(db, traceCsv(trace), `${id}.csv`);
    expect(result.status).toBe('imported');
    return result;
  };
  const read = () => ({
    runs: db.prepare('SELECT id,run_type,auto_run_type,tags,training_load,z1_seconds,z2_seconds,z3_seconds,z4_seconds,z5_seconds FROM activities ORDER BY id').all(),
    thresholds: db.prepare(`SELECT effective_date,source_activity_id,source_kind,lt1_hr,lt2_hr,confidence
      FROM physiological_thresholds ORDER BY effective_date,source_activity_id`).all(),
    summaries: db.prepare('SELECT activity_id,headline,effectiveness_score,analysis_json FROM activity_coach_summaries ORDER BY activity_id').all()
  });

  it.each([
    { direction: 'rising', early: 155, late: 174, firstType: 'threshold_lt2', lastType: 'easy_base' },
    { direction: 'falling', early: 174, late: 155, firstType: 'easy_base', lastType: 'threshold_lt2' }
  ])('handles $direction LT2 on import, replay and coaching', test => {
    measurement('2026-01-01', 130, test.early);
    measurement('2026-07-01', 145, test.late);
    expect(importSteady('winter', '2026-01-02').runType).toBe(test.firstType);
    expect(importSteady('summer', '2026-07-02').runType).toBe(test.lastType);
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    const baseline = read();
    expect(baseline.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'winter', run_type: test.firstType }),
      expect.objectContaining({ id: 'summer', run_type: test.lastType })
    ]));
    // Neither an arbitrary current cache nor another replay may rewrite history.
    db.prepare("UPDATE athlete_profile SET lt1_hr=110,lt2_hr=125 WHERE id='primary'").run();
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    expect(read()).toEqual(baseline);
    expect((db.prepare("SELECT max_hr FROM athlete_profile WHERE id='primary'").get() as { max_hr: number }).max_hr).toBe(190);
    expect(getHeartRateProfileAtDate(db, '2026-01-02').lt2Hr).toBe(test.early);
    expect(getHeartRateProfileAtDate(db, '2026-07-02').lt2Hr).toBe(test.late);
  });

  it.each([
    { direction: 'rising', early: 130, late: 150 },
    { direction: 'falling', early: 150, late: 130 }
  ])('handles $direction LT1 with unchanged LT2 and max HR', test => {
    measurement('2026-01-01', test.early, 174);
    measurement('2026-07-01', test.late, 174);
    importSteady('winter', '2026-01-02', 143);
    importSteady('summer', '2026-07-02', 143);
    realignDatabase(db);
    for (const [id, lt1] of [['winter', test.early], ['summer', test.late]] as const) {
      const row = db.prepare('SELECT tags,z3_seconds FROM activities WHERE id=?').get(id) as { tags: string; z3_seconds: number };
      expect(row.z3_seconds > 0).toBe(lt1 < 143);
      expect(JSON.parse(row.tags)).not.toContain('Tempo');
    }
  });

  it('excludes its own calibration, future observations and same-instant observations with different timestamp formats', () => {
    measurement('2026-02-02T04:59:59Z', 130, 155);
    measurement('2026-02-02T13:00:00+08:00', 150, 174);
    measurement('2026-02-02T05:00:01Z', 155, 180);
    const profile = getHeartRateProfileAtDate(db, '2026-02-02T05:00:00Z');
    expect(profile).toMatchObject({ lt1Hr: 130, lt2Hr: 155, lt2Source: 'calibrated' });
    expect(profile.lastLt2Date).toBe('2026-02-02T04:59:59Z');
  });

  it('falls back to independent estimated thresholds before the first usable evidence', () => {
    measurement('2026-07-01', 150, 174);
    measurement('2026-01-01', 130, 155, 0);
    db.prepare("UPDATE athlete_profile SET lt1_hr=150,lt2_hr=174 WHERE id='primary'").run();
    expect(getHeartRateProfileAtDate(db, '2026-01-02')).toMatchObject({
      maxHr: 190, restingHr: 50, lt1Hr: 141, lt2Hr: 165, lt1Source: 'baseline', lt2Source: 'baseline'
    });
  });

  it('does not let rejected observations crowd out valid historical evidence', () => {
    measurement('2026-01-01', 130, 155);
    for (let i = 0; i < 8; i++) measurement(`2026-01-${String(i + 2).padStart(2, '0')}`, 150, 180, 0);
    expect(getHeartRateProfileAtDate(db, '2026-01-15')).toMatchObject({ lt1Hr: 130, lt2Hr: 155 });
  });

  it('updates later workouts from rebuilt calibrations and rolls back a failed activity atomically', () => {
    measurement('2026-01-01', 130, 155);
    importSteady('a', '2026-01-02', 158);
    importSteady('b', '2026-01-03', 159);
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    expect(getHeartRateProfileAtDate(db, '2026-01-03').lt2Hr).toBeGreaterThan(155);
    const before = read();
    db.exec(`CREATE TRIGGER fail_a_calibration BEFORE INSERT ON physiological_thresholds
      WHEN NEW.source_activity_id='a' BEGIN SELECT RAISE(ABORT,'injected calibration failure'); END`);
    const stats = realignDatabase(db);
    expect(stats.activitiesFailed).toHaveLength(1);
    expect(stats.activitiesFailed[0]).toContain('injected calibration failure');
    expect(read()).toEqual(before);
  });

  it('keeps old coaching unchanged when future fitness and today’s cached thresholds change', () => {
    measurement('2026-01-01', 130, 155);
    importSteady('old', '2026-01-02');
    const before = syncActivityCoachSummary(db, 'old', undefined, { persist: false });
    measurement('2026-07-01', 150, 174);
    db.prepare("UPDATE athlete_profile SET lt1_hr=150,lt2_hr=174 WHERE id='primary'").run();
    expect(syncActivityCoachSummary(db, 'old', undefined, { persist: false })).toEqual(before);
  });
  it('keeps date-specific zones after replay and profile-derived data refresh', () => {
    measurement('2026-01-01', 130, 155);
    measurement('2026-07-01', 150, 174);
    importSteady('winter', '2026-01-02', 143);
    importSteady('summer', '2026-07-02', 143);
    const zones = () => db.prepare('SELECT id,training_load,z2_seconds,z3_seconds FROM activities ORDER BY id').all();
    const imported = zones();
    expect(imported).toEqual([
      expect.objectContaining({ id: 'summer', z2_seconds: 2400, z3_seconds: 0 }),
      expect.objectContaining({ id: 'winter', z2_seconds: 0, z3_seconds: 2400 })
    ]);
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    expect(zones()).toEqual(imported);
    recomputeProfileDerivedData(db, true);
    expect(zones()).toEqual(imported);
  });

  it('replays out-of-order imports in actual chronological order across UTC and offset dates', () => {
    measurement('2026-02-01T00:00:00Z', 130, 155);
    // SQL ordering by naive date strings cannot define evidence availability.
    importSteady('later', '2026-02-02T06:00:00Z', 159);
    importSteady('earlier', '2026-02-02T13:00:00+08:00', 158);
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    const full = read();
    expect(getHeartRateProfileAtDate(db, '2026-02-02T06:00:00Z').lt2Hr).toBeGreaterThan(155);
    expect(realignDatabase(db, { activityIds: ['later'] }).activitiesFailed).toEqual([]);
    expect(read()).toEqual(full);
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    expect(read()).toEqual(full);
  });

  it('admits lower sustained LT2 evidence instead of enforcing the previous high estimate', () => {
    measurement('2026-01-01', 145, 178);
    importSteady('lower', '2026-01-02', 168);
    // Confirmed intent supplies evidence when the achieved HR no longer clears
    // the old automatic gate, without adding a special date or pace exception.
    db.prepare("UPDATE activities SET run_type='threshold_lt2',manual_run_type='threshold_lt2' WHERE id='lower'").run();
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    expect(db.prepare("SELECT lt2_hr FROM physiological_thresholds WHERE source_activity_id='lower'").get())
      .toEqual({ lt2_hr: 168 });
    expect(getHeartRateProfileAtDate(db, '2026-01-03').lt2Hr).toBeLessThan(178);
  });

  it('excludes confirmed failed workout evidence while preserving independent dated measurements', () => {
    measurement('2026-01-01', 130, 155);
    importSteady('failed', '2026-01-02', 159);
    db.prepare("UPDATE activities SET manual_failed_workout=1 WHERE id='failed'").run();
    expect(getHeartRateProfileAtDate(db, '2026-01-03').lt2Hr).toBe(155);
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM physiological_thresholds WHERE source_activity_id='failed'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM physiological_thresholds WHERE source_kind='external'").get()).toEqual({ n: 1 });
  });

  it('uses prior pace anchors across equivalent timestamp formats and excludes same-instant or future paces', () => {
    const insertPace = db.prepare(`INSERT INTO physiological_thresholds(effective_date,source_kind,lt2_pace_sec_km,confidence)
      VALUES(?,'external',?,1)`);
    insertPace.run('2026-02-02T13:00:00+08:00', 300);
    insertPace.run('2026-02-02T05:30:00Z', 220);
    insertPace.run('2026-02-02T06:00:00Z', 200);
    expect(getStridePaceAnchorSecKmAtDate(db, '2026-02-02T05:15:00Z')).toBe(300);
    expect(getStridePaceAnchorSecKmAtDate(db, '2026-02-02T05:30:00Z')).toBe(300);
  });

  it('rebuilds later runs immediately when an earlier workout is imported or corrected', () => {
    measurement('2026-01-01', 130, 155);
    expect(importSteady('later', '2026-01-03', 153).runType).toBe('threshold_lt2');
    importSteady('backfill', '2026-01-02', 170);
    const full = read();
    expect(full.runs).toContainEqual(expect.objectContaining({ id: 'later', run_type: 'easy_base' }));
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    expect(read()).toEqual(full);
    // Force correction removes the old observation and updates descendants.
    const corrected = workoutTrace([{ seconds: 2400, hr: 135 }], { id: 'backfill', date: '2026-01-02' });
    expect(importRunContent(db, traceCsv(corrected), 'corrected.csv', { force: true }).status).toBe('imported');
    expect(read().runs).toContainEqual(expect.objectContaining({ id: 'later', run_type: 'threshold_lt2' }));
  });

  it('uses historical thresholds for the volume fallback when stored zone totals are absent', () => {
    measurement('2026-01-01', 130, 155);
    measurement('2026-07-01', 150, 174);
    importSteady('winter', '2026-01-02', 143);
    importSteady('summer', '2026-07-02', 143);
    const before = getVolumeService(db, { period: 'all' });
    db.prepare('UPDATE activities SET z1_seconds=NULL,z2_seconds=NULL,z3_seconds=NULL,z4_seconds=NULL,z5_seconds=NULL').run();
    expect(getVolumeService(db, { period: 'all' })).toEqual(before);
  });

  it('rolls back a backfill if downstream calibration fails', () => {
    measurement('2026-01-01', 130, 155);
    importSteady('later', '2026-01-03', 159);
    const before = read();
    db.exec(`CREATE TRIGGER fail_downstream BEFORE INSERT ON physiological_thresholds
      WHEN NEW.source_activity_id='later' BEGIN SELECT RAISE(ABORT,'downstream calibration failure'); END`);
    const earlier = workoutTrace([{ seconds: 2400, hr: 158 }], { id: 'backfill', date: '2026-01-02' });
    expect(importRunContent(db, traceCsv(earlier), 'backfill.csv')).toMatchObject({ status: 'error', error: expect.stringContaining('downstream calibration failure') });
    expect(read()).toEqual(before);
  });

  it('batch overwrite matches chronological replay regardless of file order and rebuilds each run once', () => {
    measurement('2026-01-01', 130, 155);
    importSteady('older', '2026-01-01', 140);
    importSteady('later', '2026-01-04', 153);
    importSteady('middle', '2026-01-03', 159);
    importSteady('earlier', '2026-01-02', 170);
    realignDatabase(db);
    const before = read();
    db.exec(`CREATE TEMP TRIGGER keep_older_summary BEFORE UPDATE ON activity_coach_summaries
      WHEN OLD.activity_id='older' BEGIN SELECT RAISE(ABORT,'unaffected summary rewritten'); END;
      CREATE TEMP TABLE replay_counts(activity_id TEXT);
      CREATE TEMP TRIGGER count_replay AFTER UPDATE OF run_type ON activities
      BEGIN INSERT INTO replay_counts VALUES(NEW.id); END;`);
    const files = [ ['later', '2026-01-04', 153], ['earlier', '2026-01-02', 170], ['middle', '2026-01-03', 159] ] as const;
    const results = importParsedRuns(db, files.map(([id, date, hr]) => ({
      parsed: parseRunCSV(traceCsv(workoutTrace([{ seconds: 2400, hr }], { id, date })), `${id}.csv`), filename: `${id}.csv`
    })), { force: true });
    expect(results.map(result => result.activityId)).toEqual(['later', 'earlier', 'middle']);
    expect(results.every(result => result.status === 'imported')).toBe(true);
    expect(read()).toEqual(before);
    expect(db.prepare('SELECT activity_id,COUNT(*) n FROM replay_counts GROUP BY activity_id ORDER BY activity_id').all())
      .toEqual([{ activity_id: 'earlier', n: 1 }, { activity_id: 'later', n: 1 }, { activity_id: 'middle', n: 1 }]);
  });

  it('rolls back the whole batch when dependent reanalysis fails', () => {
    measurement('2026-01-01', 130, 155);
    importSteady('later', '2026-01-03', 159);
    const before = read();
    db.exec(`CREATE TRIGGER fail_batch_downstream BEFORE INSERT ON physiological_thresholds
      WHEN NEW.source_activity_id='later' BEGIN SELECT RAISE(ABORT,'downstream batch failure'); END`);
    const parsed = parseRunCSV(traceCsv(workoutTrace([{ seconds: 2400, hr: 158 }], { id: 'backfill', date: '2026-01-02' })), 'backfill.csv');
    expect(() => importParsedRuns(db, [{ parsed, filename: 'backfill.csv' }])).toThrow('downstream batch failure');
    expect(read()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) n FROM activity_records WHERE activity_id='backfill'").get()).toEqual({ n: 0 });
  });

  it('rolls back a failed file savepoint while retaining successful files in the batch', () => {
    db.exec(`CREATE TRIGGER fail_file BEFORE INSERT ON activity_records
      WHEN NEW.activity_id='bad' BEGIN SELECT RAISE(ABORT,'record insertion failed'); END`);
    const results = importParsedRuns(db, ['bad', 'good'].map(id => ({
      parsed: parseRunCSV(traceCsv(workoutTrace([{ seconds: 2400, hr: 140 }], { id, date: '2026-01-02' })), `${id}.csv`), filename: `${id}.csv`
    })));
    expect(results[0]).toMatchObject({ status: 'error', error: 'record insertion failed' });
    expect(results[1]).toMatchObject({ status: 'imported', activityId: 'good' });
    expect(db.prepare('SELECT id FROM activities').all()).toEqual([{ id: 'good' }]);
    expect(db.prepare("SELECT COUNT(*) n FROM activity_records WHERE activity_id='bad'").get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT activity_id FROM activity_coach_summaries').all()).toEqual([{ activity_id: 'good' }]);
  });

  it('ignores a corrupt confidence row without losing trustworthy observations', () => {
    measurement('2026-01-01', 130, 155);
    measurement('2026-01-02', 150, 174, Infinity);
    expect(getHeartRateProfileAtDate(db, '2026-01-03')).toMatchObject({ lt1Hr: 130, lt2Hr: 155 });
  });

  it('excludes the old self-calibration when a force import corrects a workout date', () => {
    measurement('2026-01-01', 130, 155);
    expect(importSteady('corrected-date', '2026-01-02', 170).runType).toBe('threshold_lt2');
    const trace = workoutTrace([{ seconds: 2400, hr: 153 }], { id: 'corrected-date', date: '2026-01-04' });
    expect(importRunContent(db, traceCsv(trace), 'date-corrected.csv', { force: true }))
      .toMatchObject({ status: 'imported', runType: 'threshold_lt2' });
    expect(getHeartRateProfileAtDate(db, '2026-01-04', 'corrected-date').lt2Hr).toBe(155);
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    expect(read().runs).toContainEqual(expect.objectContaining({ id: 'corrected-date', run_type: 'threshold_lt2' }));
  });

  it('rebuilds intervening workouts when a correction moves an older source to a later date', () => {
    measurement('2026-01-01', 130, 155);
    importSteady('moved', '2026-01-02', 170);
    expect(importSteady('between', '2026-01-03', 153).runType).toBe('easy_base');
    const corrected = workoutTrace([{ seconds: 2400, hr: 165 }], { id: 'moved', date: '2026-01-04' });
    expect(importRunContent(db, traceCsv(corrected), 'moved.csv', { force: true }).status).toBe('imported');
    expect(read().runs).toContainEqual(expect.objectContaining({ id: 'between', run_type: 'threshold_lt2' }));
    const imported = read();
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    expect(read()).toEqual(imported);
  });

});
