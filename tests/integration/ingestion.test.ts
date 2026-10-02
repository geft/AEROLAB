import { seedBenchmarkProfile } from '../fixtures/benchmark-runs.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { getDatabase } from '../../src/backend/db/client';
import { importRunContent, importRunFile, importDirectory } from '../../src/backend/ingestion/importer';
import { BENCHMARKS, getBenchmark, toCsv } from '../fixtures/benchmark-runs';
import { realignDatabase } from '../../src/backend/db/realign.js';
import { updateActivityService } from '../../src/backend/services/activity-service.js';

describe('Database Ingestion Pipeline (Integration)', () => {
  let db: Database.Database;
  const easyBenchmark = getBenchmark('bench-easy-60');
  const easyCsv = toCsv(easyBenchmark);

  beforeEach(() => {
    // In-memory database for clean, isolated test runs
    db = getDatabase(':memory:');
    seedBenchmarkProfile(db, { datedThresholds: true });
  });

  afterEach(() => {
    db.close();
  });

  it('preserves a confirmed failed attempt through force reimport, including an agreeing automatic label', () => {
    const bench = getBenchmark('bench-race-5k');
    expect(importRunContent(db, toCsv(bench), 'trial.csv').status).toBe('imported');
    const automatic = (db.prepare('SELECT auto_run_type FROM activities WHERE id=?').get(bench.id) as { auto_run_type: string }).auto_run_type;
    expect(updateActivityService(db, bench.id, { run_type: automatic, is_failed_workout: true }).ok).toBe(true);
    expect(importRunContent(db, toCsv(bench), 'trial.csv', { force: true }).status).toBe('imported');
    expect(db.prepare('SELECT run_type,manual_run_type,manual_failed_workout FROM activities WHERE id=?').get(bench.id))
      .toEqual({ run_type: automatic, manual_run_type: automatic, manual_failed_workout: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM physiological_thresholds WHERE source_activity_id=?').get(bench.id)).toEqual({ n: 0 });
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    expect(db.prepare('SELECT run_type,manual_run_type,manual_failed_workout FROM activities WHERE id=?').get(bench.id))
      .toEqual({ run_type: automatic, manual_run_type: automatic, manual_failed_workout: 1 });
  });

  it('replays the same history independently of cached inferred thresholds', () => {
    for (const bench of BENCHMARKS) importRunContent(db, toCsv(bench), `${bench.id}.csv`);
    const read = () => ({
      thresholds: db.prepare('SELECT source_activity_id, lt1_hr, lt1_pace_sec_km, lt2_hr, lt2_pace_sec_km FROM physiological_thresholds ORDER BY source_activity_id').all(),
      runs: db.prepare('SELECT id, run_type FROM activities ORDER BY id').all()
    });
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    const first = read();
    db.prepare("UPDATE athlete_profile SET lt1_hr = 130, lt2_hr = 160 WHERE id = 'primary'").run();
    expect(realignDatabase(db).activitiesFailed).toEqual([]);
    expect(read()).toEqual(first);
    realignDatabase(db);
    expect(read()).toEqual(first);
  });

  it('imports activity, computes running economy, and stores splits & records', () => {
    const weatherFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected weather lookup'));
    try {
      const res = importRunContent(db, easyCsv, 'bench-easy-60.csv');
      expect(res.status).toBe('imported');
      expect(res.activityId).toBe('bench-easy-60');
      expect(res.runType).toBe('easy_base');

      // Query activities table
      const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get('bench-easy-60') as any;
      expect(activity).toBeDefined();
      expect(activity.name).toBe('Benchmark Easy Aerobic');
      expect(activity.avg_heart_rate).toBe(138);
      expect(activity.distance_meters).toBeCloseTo(11880, 0);
      expect(activity.efficiency_factor).toBeGreaterThan(0);
      expect(activity.workout_lat).toBeCloseTo(1.345, 2);
      expect(activity.workout_lon).toBeCloseTo(103.854, 2);

      // Query records table
      const recordCount = db.prepare('SELECT COUNT(*) as count FROM activity_records WHERE activity_id = ?').get('bench-easy-60') as any;
      expect(recordCount.count).toBeGreaterThan(0);
      expect(weatherFetch).not.toHaveBeenCalled();
    } finally {
      weatherFetch.mockRestore();
    }
  });

  it('infers an unnamed continuous benchmark and rebuilds race segmentation on realignment', () => {
    const benchmark = {
      ...getBenchmark('bench-race-5k'), name: 'Evening Running',
      rows: getBenchmark('bench-race-5k').rows.map(row => ({ ...row, hr: row.t >= 120 && row.t < 1080 ? 195 : row.hr }))
    };
    expect(importRunContent(db, toCsv(benchmark), 'evening.csv')).toMatchObject({ status: 'imported', runType: 'race' });
    const read = () => ({
      activity: db.prepare('SELECT name,run_type,auto_run_type,tags FROM activities WHERE id=?').get(benchmark.id),
      intervals: db.prepare('SELECT type,start_seconds,duration_seconds FROM activity_intervals WHERE activity_id=? ORDER BY interval_index').all(benchmark.id),
      analysis: JSON.parse((db.prepare('SELECT analysis_json FROM activity_coach_summaries WHERE activity_id=?').get(benchmark.id) as { analysis_json: string }).analysis_json)
    });
    const imported = read();
    expect(imported.analysis.rubricFamily).toBe('race');
    db.prepare("UPDATE activities SET run_type='threshold_lt2', auto_run_type='threshold_lt2', tags='[\"Threshold\",\"Strides\"]' WHERE id=?").run(benchmark.id);
    expect(realignDatabase(db, { activityIds: [benchmark.id] })).toMatchObject({ activitiesFailed: [], runTypeChanges: [{ id: benchmark.id, from: 'threshold_lt2', to: 'race' }] });
    const rebuilt = read();
    expect(rebuilt.activity).toEqual(imported.activity);
    expect(rebuilt.intervals).toEqual(imported.intervals);
    expect(rebuilt.analysis.rubricFamily).toBe('race');
    expect(realignDatabase(db, { activityIds: [benchmark.id] }).runTypeChanges).toEqual([]);
  });

  it('imports and replays three preparation strides without splitting the main race or using its name', () => {
    const benchmark = { ...getBenchmark('bench-race-5k'), id: 'race-preparation', name: 'Evening Running' };
    const rows: typeof benchmark.rows = [];
    const append = (seconds: number, hr: number, cad: number, spd: number) => {
      for (let i = 0; i < seconds; i++) rows.push({ t: rows.length, hr, cad, spd });
    };
    append(900, 140, 170, 2.5);
    append(60, 135, 100, 1.2);
    for (let stride = 0; stride < 3; stride++) {
      append(4, 135, 0, 4);
      append(16, 145, 196, 4);
      append(60, 135, 100, 1.2);
    }
    append(1180, 193, 185, 3.8);
    append(20, 195, 205, 5);
    append(60, 150, 100, 1.2);
    append(300, 140, 170, 2.5);
    benchmark.rows = rows;
    expect(importRunContent(db, toCsv(benchmark), 'evening.csv')).toMatchObject({ status: 'imported', runType: 'race' });
    const read = () => ({
      activity: db.prepare('SELECT run_type,auto_run_type,tags FROM activities WHERE id=?').get(benchmark.id),
      intervals: db.prepare('SELECT type,start_seconds,duration_seconds,distance_meters FROM activity_intervals WHERE activity_id=? ORDER BY interval_index').all(benchmark.id) as { type: string; start_seconds: number; duration_seconds: number }[]
    });
    const imported = read();
    expect(imported.activity).toMatchObject({ run_type: 'race', tags: '["Race","Strides"]' });
    expect(imported.intervals.filter(interval => interval.type === 'stride')).toHaveLength(3);
    expect(imported.intervals.filter(interval => interval.type === 'work')).toMatchObject([{ start_seconds: 1200, duration_seconds: 1199 }]);
    db.prepare("UPDATE activities SET name='Recovery DNF VO2 TT', run_type='threshold_lt2', auto_run_type='threshold_lt2', tags='[]' WHERE id=?").run(benchmark.id);
    db.prepare("DELETE FROM activity_intervals WHERE activity_id=? AND type='stride'").run(benchmark.id);
    for (let replay = 0; replay < 2; replay++) {
      expect(realignDatabase(db, { activityIds: [benchmark.id] }).activitiesFailed).toEqual([]);
      expect(read()).toEqual(imported);
    }
  });

  it('keeps rolling long-run surges out of the Strides tag on import and stale-analysis replay', () => {
    const benchmark = { ...getBenchmark('bench-long-120'), name: 'Strides',
      rows: getBenchmark('bench-long-120').rows.map(row => [900, 3600, 6100].some(start => row.t >= start && row.t < start + 20)
        ? { ...row, spd: 5, cad: 196, hr: 145 } : row) };
    expect(importRunContent(db, toCsv(benchmark), 'long-run.csv')).toMatchObject({ status: 'imported', runType: 'long_run' });
    const read = () => ({
      activity: db.prepare('SELECT run_type,tags FROM activities WHERE id=?').get(benchmark.id),
      strides: db.prepare("SELECT COUNT(*) AS count FROM activity_intervals WHERE activity_id=? AND type='stride'").get(benchmark.id)
    });
    const imported = read();
    expect(imported).toEqual({ activity: { run_type: 'long_run', tags: '["Long Run"]' }, strides: { count: 0 } });
    db.prepare("UPDATE activities SET tags='[\"Long Run\",\"Strides\"]' WHERE id=?").run(benchmark.id);
    db.prepare("UPDATE activity_intervals SET type='stride' WHERE activity_id=?").run(benchmark.id);
    expect(realignDatabase(db, { activityIds: [benchmark.id] }).activitiesFailed).toEqual([]);
    expect(read()).toEqual(imported);
  });

  it('classifies every benchmark run as documented (living classification benchmark)', () => {
    for (const bench of BENCHMARKS) {
      const res = importRunContent(db, toCsv(bench), `${bench.id}.csv`);
      expect(res.status).toBe('imported');

      const activity = db.prepare('SELECT run_type, tags FROM activities WHERE id = ?').get(bench.id) as any;
      expect(activity.run_type).toBe(bench.expectedRunType);

      const tags: string[] = JSON.parse(activity.tags || '[]');
      for (const expected of bench.expectedTags) {
        expect(tags).toContain(expected);
      }
    }
  });

  it.each(BENCHMARKS)('keeps $id classification, segmentation, tags and coaching independent of its name', benchmark => {
    const read = () => ({
      activity: db.prepare('SELECT run_type,auto_run_type,tags FROM activities WHERE id=?').get(benchmark.id),
      intervals: db.prepare('SELECT type,start_seconds,duration_seconds FROM activity_intervals WHERE activity_id=? ORDER BY interval_index').all(benchmark.id),
      coach: db.prepare('SELECT headline,effectiveness_score,analysis_json FROM activity_coach_summaries WHERE activity_id=?').get(benchmark.id)
    });
    expect(importRunContent(db, toCsv(benchmark), 'workout.csv').status).toBe('imported');
    const baseline = read();
    for (const name of ['', 'Graceful Recovery', 'VO2 V02 Race Parkrun Time Trial TT Tempo MP Marathon Pace Failed Aborted DNF Bailed Strides']) {
      expect(updateActivityService(db, benchmark.id, { name: name || 'Untitled' }).ok).toBe(true);
      expect(read()).toEqual(baseline);
      seedBenchmarkProfile(db, { datedThresholds: true });
      expect(importRunContent(db, toCsv({ ...benchmark, name }), 'workout.csv', { force: true }).status).toBe('imported');
      expect(read()).toEqual(baseline);
    }
    // A stale stored type must not direct segmentation before classification.
    db.prepare("UPDATE activities SET run_type='race', auto_run_type='race' WHERE id=?").run(benchmark.id);
    expect(realignDatabase(db, { activityIds: [benchmark.id] }).activitiesFailed).toEqual([]);
    expect(read().activity).toEqual(baseline.activity);
    expect(read().intervals).toEqual(baseline.intervals);
  });

  it('detects threshold work reps with dynamics and a rounded prescription', () => {
    importRunContent(db, toCsv(getBenchmark('bench-threshold-3x10')), 'bench-threshold-3x10.csv');

    const intervals = db.prepare("SELECT * FROM activity_intervals WHERE activity_id = ? AND type = 'work' ORDER BY interval_index ASC").all('bench-threshold-3x10') as any[];
    expect(intervals.length).toBe(3);
    for (const inv of intervals) {
      expect(Math.abs(inv.duration_seconds - 600)).toBeLessThan(60);
      expect(inv.avg_vert_osc).toBeGreaterThan(0);
      expect(inv.avg_stance_time).toBeGreaterThan(0);
      expect(inv.avg_step_length).toBeGreaterThan(0);
      expect(inv.avg_stride_length).toBeGreaterThan(0);
    }
  });

  it('detects VO2 work reps and easy-run strides without work reps', () => {
    importRunContent(db, toCsv(getBenchmark('bench-vo2-5x3')), 'bench-vo2-5x3.csv');
    const vo2Works = db.prepare("SELECT * FROM activity_intervals WHERE activity_id = ? AND type = 'work'").all('bench-vo2-5x3') as any[];
    expect(vo2Works.length).toBe(5);

    importRunContent(db, toCsv(getBenchmark('bench-easy-strides')), 'bench-easy-strides.csv');
    const strideRows = db.prepare("SELECT * FROM activity_intervals WHERE activity_id = ? AND type = 'stride'").all('bench-easy-strides') as any[];
    expect(strideRows.length).toBe(4);
    const easyWorks = db.prepare("SELECT * FROM activity_intervals WHERE activity_id = ? AND type = 'work'").all('bench-easy-strides') as any[];
    expect(easyWorks.length).toBe(0);
  });

  it('safely skips duplicate files using SHA-256 hash', () => {
    const firstImport = importRunContent(db, easyCsv, 'bench-easy-60.csv');
    expect(firstImport.status).toBe('imported');

    // Second import of same content
    const secondImport = importRunContent(db, easyCsv, 'bench-easy-60.csv');
    expect(secondImport.status).toBe('skipped_duplicate');
    expect(secondImport.activityId).toBe('bench-easy-60');

    // Ensure only 1 row in activities table
    const count = db.prepare('SELECT COUNT(*) as count FROM activities').get() as any;
    expect(count.count).toBe(1);
  });

  it('skips duplicate activity when imported with different ID/filename if start time and distance match', () => {
    const firstImport = importRunContent(db, easyCsv, 'garmin_export_1.csv');
    expect(firstImport.status).toBe('imported');

    // Generate modified CSV with different activity ID and extra whitespace comments to change hash
    const differentCsv = easyCsv
      .replace('# Activity ID: bench-easy-60', '# Activity ID: fit_synthetic_999')
      .concat('\n# Extra comment padding to change SHA256 hash');

    const secondImport = importRunContent(db, differentCsv, 'fit_synthetic_999.csv');
    expect(secondImport.status).toBe('skipped_duplicate');
    expect(secondImport.activityId).toBe('bench-easy-60');

    // Total activities must remain 1
    const count = db.prepare('SELECT COUNT(*) as count FROM activities').get() as any;
    expect(count.count).toBe(1);
  });

  it('allows force re-import when force: true is specified', () => {
    const firstImport = importRunContent(db, easyCsv, 'bench-easy-60.csv');
    expect(firstImport.status).toBe('imported');

    // Force re-import replaces the activity
    const forceImport = importRunContent(db, easyCsv, 'bench-easy-60.csv', { force: true });
    expect(forceImport.status).toBe('imported');
    expect(forceImport.activityId).toBe('bench-easy-60');

    const count = db.prepare('SELECT COUNT(*) as count FROM activities').get() as any;
    expect(count.count).toBe(1);
  });

  it('detects and inserts structured workout intervals during ingestion', () => {
    // Construct CSV with alternating fast work reps (5 m/s) and recovery (2 m/s)
    let intervalCsv = `
# Activity: 400m Track Repeats
# Activity ID: interval-run-101
# Date: 2026-09-12 18:00:00
# Sport: running
timestamp,heart_rate,cadence,speed,distance,ground_contact_time
`;
    let t = 0;
    let dist = 0;
    const ts = (s: number): string =>
      `2026-09-12T18:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    // 3 work reps of 60s at 5.0 m/s with 60s recovery at 2.0 m/s
    for (let rep = 0; rep < 3; rep++) {
      // Work rep
      for (let s = 0; s < 60; s++, t++) {
        dist += 5.0;
        intervalCsv += `${ts(t)},165,180,5.0,${dist},220\n`;
      }
      // Recovery
      for (let s = 0; s < 60; s++, t++) {
        dist += 2.0;
        intervalCsv += `${ts(t)},135,140,2.0,${dist},280\n`;
      }
    }

    const res = importRunContent(db, intervalCsv, 'track-workout.csv');
    expect(res.status).toBe('imported');
    expect(res.intervalsDetected).toBeGreaterThanOrEqual(1);

    const intervals = db.prepare('SELECT * FROM activity_intervals WHERE activity_id = ?').all('interval-run-101') as any[];
    expect(intervals.length).toBeGreaterThanOrEqual(1);
    expect(intervals[0].avg_speed_mps).toBeGreaterThan(0);
    expect(intervals[0].avg_heart_rate).toBeGreaterThan(0);
  });

  it('importRunFile returns error when file does not exist', () => {
    const res = importRunFile(db, path.resolve(__dirname, '../fixtures/non-existent-file.csv'));
    expect(res.status).toBe('error');
    expect(res.error).toContain('File not found');
  });

  it('importRunFile imports valid CSV file directly from disk', () => {
    const tmpPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-')), 'bench-easy-60.csv');
    fs.writeFileSync(tmpPath, easyCsv, 'utf8');
    try {
      const res = importRunFile(db, tmpPath);
      expect(res.status).toBe('imported');
      expect(res.activityId).toBe('bench-easy-60');
    } finally {
      fs.rmSync(path.dirname(tmpPath), { recursive: true, force: true });
    }
  });

  it('importRunFile handles FIT binary file and rejects non-running FIT', () => {
    const tmpDir = path.resolve(__dirname, '../fixtures/tmp-fit-test');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    // 1. Synthetic Running FIT
    const garminSec = 1126080000;
    const defSession = [
      0x40, 0x00, 0x00, 18, 0, 5,
      253, 4, 0x86, 2, 4, 0x86, 5, 1, 0x00, 9, 4, 0x86, 8, 4, 0x86
    ];
    const runSessionData = Buffer.alloc(1 + 17);
    runSessionData.writeUInt8(0x00, 0);
    runSessionData.writeUInt32LE(garminSec, 1);
    runSessionData.writeUInt32LE(garminSec, 5);
    runSessionData.writeUInt8(1, 9); // sport = 1 (running)
    runSessionData.writeUInt32LE(500000, 10);
    runSessionData.writeUInt32LE(1500000, 14);

    const defRecord = [
      0x41, 0x00, 0x00, 20, 0, 4,
      253, 4, 0x86, 3, 1, 0x02, 4, 1, 0x02, 5, 4, 0x86
    ];
    const recData = Buffer.alloc(1 + 10);
    recData.writeUInt8(0x01, 0);
    recData.writeUInt32LE(garminSec, 1);
    recData.writeUInt8(142, 5);
    recData.writeUInt8(88, 6);
    recData.writeUInt32LE(20000, 7);

    const runPayload = Buffer.concat([Buffer.from(defSession), runSessionData, Buffer.from(defRecord), recData]);
    const header = Buffer.alloc(14);
    header.writeUInt8(14, 0);
    header.writeUInt8(0x20, 1);
    header.writeUInt16LE(0x0824, 2);
    header.writeUInt32LE(runPayload.length, 4);
    header.write('.FIT', 8, 'ascii');

    const runningFitPath = path.join(tmpDir, 'test_run.fit');
    fs.writeFileSync(runningFitPath, Buffer.concat([header, runPayload]));

    const runRes = importRunFile(db, runningFitPath);
    expect(runRes.status).toBe('imported');

    // 2. Non-running FIT (e.g. sport = 2 cycling)
    const cycleSessionData = Buffer.alloc(1 + 17);
    cycleSessionData.writeUInt8(0x00, 0);
    cycleSessionData.writeUInt32LE(garminSec, 1);
    cycleSessionData.writeUInt32LE(garminSec, 5);
    cycleSessionData.writeUInt8(2, 9); // sport = 2 (cycling)
    cycleSessionData.writeUInt32LE(1500000, 10);
    cycleSessionData.writeUInt32LE(3600000, 14);

    const cyclePayload = Buffer.concat([Buffer.from(defSession), cycleSessionData]);
    const cycleHeader = Buffer.alloc(14);
    cycleHeader.writeUInt8(14, 0);
    cycleHeader.writeUInt8(0x20, 1);
    cycleHeader.writeUInt16LE(0x0824, 2);
    cycleHeader.writeUInt32LE(cyclePayload.length, 4);
    cycleHeader.write('.FIT', 8, 'ascii');

    const cyclingFitPath = path.join(tmpDir, 'test_cycle.fit');
    fs.writeFileSync(cyclingFitPath, Buffer.concat([cycleHeader, cyclePayload]));

    const cycleRes = importRunFile(db, cyclingFitPath);
    expect(cycleRes.status).toBe('skipped_non_running');
    expect(cycleRes.reason).toContain('not a supported running session');

    // 3. Add a non-csv/fit file to test directory filtering
    const txtPath = path.join(tmpDir, 'notes.txt');
    fs.writeFileSync(txtPath, 'some notes');

    // Test importDirectory skips non-csv/fit
    const dirResults = importDirectory(db, tmpDir);
    expect(Array.isArray(dirResults)).toBe(true);
    expect(dirResults.length).toBe(2);

    // 4. Test importDirectory on non-existent folder
    const emptyResults = importDirectory(db, path.join(tmpDir, 'non_existent_folder'));
    expect(emptyResults).toEqual([]);

    // Clean up temporary files
    try {
      fs.unlinkSync(runningFitPath);
      fs.unlinkSync(cyclingFitPath);
      fs.unlinkSync(txtPath);
      fs.rmdirSync(tmpDir);
    } catch { /* best-effort cleanup: safe to ignore */ }
  });

  it('rejects title-only tags and detects limited quality stimulus from the recorded reps', () => {
    // 1. Long run with Marathon Pace
    const mpCsv = `
# Activity: Sunday Long Run with Marathon Pace MP
# Activity ID: mp-run-999
# Date: 2026-09-12 07:00:00
# Total Duration (s): 7200
# Total Distance (m): 24000
# Avg Heart Rate (bpm): 152
timestamp,heart_rate,cadence,speed,distance
2026-09-12T07:00:00,152,170,3.75,10
2026-09-12T09:00:00,152,170,3.75,24000
`;
    const resMp = importRunContent(db, mpCsv, 'mp-run.csv');
    expect(resMp.status).toBe('imported');
    const actMp = db.prepare('SELECT tags FROM activities WHERE id = ?').get('mp-run-999') as any;
    expect(JSON.parse(actMp.tags)).toEqual(['Long Run']);

    // 2. Short aborted VO2-style reps: no real strides here (60s reps are work,
    //    not <=45s bursts), so no Strides tag despite the activity name.
    let failedCsv = `
# Activity: Failed VO2 Intervals Bailed DNF with Strides
# Activity ID: tempo-strides-999
# Date: 2026-09-12 18:00:00
# Avg Heart Rate (bpm): 165
timestamp,heart_rate,cadence,speed,distance
`;
    let t2 = 0;
    let dist2 = 0;
    const ts2 = (s: number): string =>
      `2026-09-12T18:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    for (let rep = 0; rep < 2; rep++) {
      for (let s = 0; s < 60; s++, t2++) {
        dist2 += 5.2;
        failedCsv += `${ts2(t2)},190,185,5.2,${dist2}\n`;
      }
      for (let s = 0; s < 60; s++, t2++) {
        dist2 += 2.0;
        failedCsv += `${ts2(t2)},135,140,2.0,${dist2}\n`;
      }
    }
    const resFailed = importRunContent(db, failedCsv, 'failed.csv');
    expect(resFailed.status).toBe('imported');
    const actFailed = db.prepare('SELECT tags FROM activities WHERE id = ?').get('tempo-strides-999') as any;
    expect(actFailed.tags).toContain('VO2 Max');
    expect(actFailed.tags).not.toContain('Strides');
    expect(actFailed.tags).not.toContain('Failed Workout');

    // Confirm failed workout receives <70 execution score (1 star / Bronze) without a tag
    const coachRow = db.prepare('SELECT effectiveness_score FROM activity_coach_summaries WHERE activity_id = ?').get('tempo-strides-999') as any;
    expect(coachRow.effectiveness_score).toBeLessThan(70);
  });
});
