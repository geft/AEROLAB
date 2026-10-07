import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { createMigrationRunner } from '../../src/backend/db/migrations.js';
import { openDatabase } from '../../src/backend/db/client.js';
import { importRunContent } from '../../src/backend/ingestion/importer.js';
import { workoutTrace, traceCsv } from '../fixtures/workout-trace.js';
import { getBenchmark, seedBenchmarkProfile, toCsv } from '../fixtures/benchmark-runs.js';
import { ANALYSIS_REVISION } from '../../src/shared/analysis-revision.js';

describe('named database migrations', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(['coaching-duration-v1', 'classification-telemetry-v1', 'sustained-work-v1', 'aerobic-reference-v1'])('refreshes pending %s once and persists the current revision', migration => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-duration-migration-'));
    roots.push(root);
    const file = path.join(root, 'runs.db');
    const first = openDatabase(file);
    const trace = workoutTrace([{ seconds: 120, hr: 140 }], { id: 'density', steps: [5] });
    expect(importRunContent(first, traceCsv(trace), 'run.csv').status).toBe('imported');
    first.prepare('DELETE FROM schema_migrations WHERE name=?').run(migration);
    first.prepare("UPDATE activity_coach_summaries SET headline='outdated'").run();
    first.close();
    const migrated = openDatabase(file);
    const summary = migrated.prepare('SELECT headline, analysis_json, updated_at FROM activity_coach_summaries').get() as { headline: string; analysis_json: string; updated_at: string };
    expect(summary.headline).not.toBe('outdated');
    expect(JSON.parse(summary.analysis_json).revision).toBe(ANALYSIS_REVISION);
    expect(migrated.prepare('SELECT name FROM schema_migrations WHERE name=?').get(migration)).toBeTruthy();
    migrated.close();
    const reopened = openDatabase(file);
    expect(reopened.prepare('SELECT headline, analysis_json, updated_at FROM activity_coach_summaries').get()).toEqual(summary);
    reopened.close();
  });

  it('rolls back an interrupted step and retries it on the next start', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-migration-'));
    roots.push(root);
    const db = new Database(path.join(root, 'runs.db'));
    db.exec('CREATE TABLE activities (id TEXT PRIMARY KEY, value INTEGER); INSERT INTO activities VALUES (\'a\', 1)');

    const first = createMigrationRunner(db);
    expect(first.run('update-value', () => {
      db.prepare('UPDATE activities SET value = 2').run();
      throw new Error('interrupted');
    })).toBe(false);
    expect((db.prepare('SELECT value FROM activities').get() as { value: number }).value).toBe(1);
    expect(first.snapshotPath && fs.existsSync(first.snapshotPath)).toBe(true);

    const retry = createMigrationRunner(db);
    expect(retry.run('update-value', () => db.prepare('UPDATE activities SET value = 3').run())).toBe(true);
    expect((db.prepare('SELECT value FROM activities').get() as { value: number }).value).toBe(3);
    expect(retry.run('update-value', () => { throw new Error('should not repeat'); })).toBe(true);
    db.close();
  });

  it('refreshes equivalent upgrades once and rolls back every pending checkpoint on failure', () => {
    const db = new Database(':memory:');
    try {
      db.exec("CREATE TABLE activities (id TEXT PRIMARY KEY, value INTEGER); INSERT INTO activities VALUES ('a', 1)");
      const first = createMigrationRunner(db);
      expect(first.runGroup(['one', 'two'], () => {
        db.prepare('UPDATE activities SET value=2').run();
        throw new Error('interrupted');
      })).toBe(false);
      expect(db.prepare('SELECT value FROM activities').get()).toEqual({ value: 1 });
      expect(db.prepare('SELECT name FROM schema_migrations').all()).toEqual([]);
      const retry = createMigrationRunner(db);
      let passes = 0;
      expect(retry.runGroup(['one', 'two'], () => { passes++; })).toBe(true);
      expect(retry.runGroup(['one', 'two'], () => { passes++; })).toBe(true);
      expect(passes).toBe(1);
      expect(db.prepare('SELECT name FROM schema_migrations ORDER BY name').all()).toEqual([{ name: 'one' }, { name: 'two' }]);
    } finally { db.close(); }
  });

  it('migrates existing manual labels and preserves them on subsequent replays', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-confirmed-migration-'));
    roots.push(root);
    const file = path.join(root, 'runs.db');
    const first = openDatabase(file);
    seedBenchmarkProfile(first);
    const bench = getBenchmark('bench-easy-60');
    importRunContent(first, toCsv(bench), 'run.csv');
    first.exec('ALTER TABLE activities DROP COLUMN manual_run_type; ALTER TABLE activities DROP COLUMN manual_failed_workout');
    first.prepare("DELETE FROM schema_migrations WHERE name='confirmed-workout-intent-v1'").run();
    first.prepare("UPDATE activities SET run_type='intervals_vo2' WHERE id=?").run(bench.id);
    first.close();
    const migrated = openDatabase(file);
    expect(migrated.prepare('SELECT run_type,manual_run_type,auto_run_type FROM activities WHERE id=?').get(bench.id))
      .toEqual({ run_type: 'intervals_vo2', manual_run_type: 'intervals_vo2', auto_run_type: 'easy_base' });
    migrated.close();
  });

  it('maps a completed legacy migration marker to named steps', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE activities (id TEXT PRIMARY KEY); PRAGMA user_version = 1');
    const runner = createMigrationRunner(db);
    expect(runner.run('centroid-v1', () => { throw new Error('already complete'); })).toBe(true);
    let applied = false;
    expect(runner.run('continuous-race-v1', () => { applied = true; })).toBe(true);
    expect(applied).toBe(true);
    expect(runner.run('signal-classification-v1', () => { applied = false; })).toBe(true);
    expect(applied).toBe(false);
    db.close();
  });

  it('adds native FIT telemetry columns to an existing database without losing its runs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-fit-migration-'));
    roots.push(root);
    const file = path.join(root, 'runs.db');
    const first = openDatabase(file);
    seedBenchmarkProfile(first);
    const bench = getBenchmark('bench-easy-60');
    expect(importRunContent(first, toCsv(bench), 'run.csv').status).toBe('imported');
    const count = (first.prepare('SELECT count(*) AS count FROM activity_records').get() as { count: number }).count;
    for (const name of ['power_w', 'vertical_ratio', 'stance_time_balance', 'step_length_m', 'respiration_rate', 'core_temperature_c', 'fractional_cadence', 'fit_fields_json']) {
      first.exec(`ALTER TABLE activity_records DROP COLUMN ${name}`);
    }
    first.exec('DROP TABLE activity_fit_details');
    first.prepare("DELETE FROM schema_migrations WHERE name = 'fit-telemetry-v2'").run();
    first.close();
    const migrated = openDatabase(file);
    expect((migrated.prepare('SELECT count(*) AS count FROM activity_records').get() as { count: number }).count).toBe(count);
    const columns = (migrated.prepare('PRAGMA table_info(activity_records)').all() as Array<{ name: string }>).map(column => column.name);
    expect(columns).toContain('power_w');
    expect(columns).toContain('fit_fields_json');
    expect(migrated.prepare('SELECT count(*) AS count FROM activity_fit_details').get()).toEqual({ count: 0 });
    migrated.close();
  });

  it('rebuilds stale title-derived analysis once and preserves the activity name', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-signal-migration-'));
    roots.push(root);
    const file = path.join(root, 'runs.db');
    const first = openDatabase(file);
    seedBenchmarkProfile(first);
    const benchmark = { ...getBenchmark('bench-easy-60'), name: 'Race Time Trial VO2 Recovery Failed DNF Tempo MP' };
    expect(importRunContent(first, toCsv(benchmark), 'run.csv').status).toBe('imported');
    first.prepare("UPDATE activities SET run_type='race', auto_run_type='race', tags='[\"Race\"]' WHERE id=?").run(benchmark.id);
    first.prepare("DELETE FROM schema_migrations WHERE name='signal-classification-v1'").run();
    first.close();

    const migrated = openDatabase(file);
    const read = () => migrated.prepare('SELECT name,run_type,tags FROM activities WHERE id=?').get(benchmark.id);
    expect(read()).toEqual({ name: benchmark.name, run_type: 'easy_base', tags: '["Easy Base"]' });
    expect(migrated.prepare("SELECT 1 FROM schema_migrations WHERE name='signal-classification-v1'").get()).toBeTruthy();
    expect(fs.readdirSync(path.join(root, 'backups')).some(name => name.startsWith('pre-migration-'))).toBe(true);
    const coach = migrated.prepare('SELECT headline,updated_at FROM activity_coach_summaries WHERE activity_id=?').get(benchmark.id);
    migrated.close();
    const reopened = openDatabase(file);
    expect(reopened.prepare('SELECT headline,updated_at FROM activity_coach_summaries WHERE activity_id=?').get(benchmark.id)).toEqual(coach);
    reopened.close();
  });

  it.each(['effort-structure-v1', 'stride-recovery-v1'])('restores missing strides once with a backup: %s', migration => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-effort-migration-'));
    roots.push(root);
    const file = path.join(root, 'runs.db');
    const first = openDatabase(file);
    seedBenchmarkProfile(first);
    const benchmark = { ...getBenchmark('bench-easy-strides'), name: 'Evening Running' };
    expect(importRunContent(first, toCsv(benchmark), 'run.csv').status).toBe('imported');
    first.prepare("DELETE FROM activity_intervals WHERE activity_id=? AND type='stride'").run(benchmark.id);
    first.prepare("UPDATE activities SET tags='[\"Easy Base\"]' WHERE id=?").run(benchmark.id);
    first.prepare('DELETE FROM schema_migrations WHERE name=?').run(migration);
    first.close();
    const migrated = openDatabase(file);
    expect(migrated.prepare("SELECT COUNT(*) AS count FROM activity_intervals WHERE activity_id=? AND type='stride'").get(benchmark.id)).toEqual({ count: 4 });
    expect(migrated.prepare('SELECT name,tags FROM activities WHERE id=?').get(benchmark.id)).toEqual({ name: benchmark.name, tags: '["Easy Base","Strides"]' });
    expect(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(migration)).toBeTruthy();
    expect(fs.readdirSync(path.join(root, 'backups')).some(name => name.startsWith('pre-migration-'))).toBe(true);
    const coach = migrated.prepare('SELECT headline,updated_at FROM activity_coach_summaries WHERE activity_id=?').get(benchmark.id);
    migrated.close();
    const reopened = openDatabase(file);
    expect(reopened.prepare('SELECT headline,updated_at FROM activity_coach_summaries WHERE activity_id=?').get(benchmark.id)).toEqual(coach);
    reopened.close();
  });

  it('reclassifies saved low-HRR Zone 2 runs once with a backup', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-recovery-migration-'));
    roots.push(root);
    const file = path.join(root, 'runs.db');
    const first = openDatabase(file);
    seedBenchmarkProfile(first);
    const source = getBenchmark('bench-recovery-25');
    const benchmark = { ...source, rows: source.rows.map(row => ({ ...row, hr: 135 })) };
    expect(importRunContent(first, toCsv(benchmark), 'run.csv').status).toBe('imported');
    first.prepare("UPDATE activities SET run_type='easy_base', auto_run_type='easy_base', tags='[\"Easy Base\"]' WHERE id=?").run(benchmark.id);
    first.prepare("DELETE FROM schema_migrations WHERE name='recovery-hrr-v1'").run();
    first.close();
    const migrated = openDatabase(file);
    expect(migrated.prepare('SELECT run_type,auto_run_type,tags FROM activities WHERE id=?').get(benchmark.id))
      .toEqual({ run_type: 'recovery', auto_run_type: 'recovery', tags: '["Recovery"]' });
    expect(migrated.prepare("SELECT 1 FROM schema_migrations WHERE name='recovery-hrr-v1'").get()).toBeTruthy();
    expect(fs.readdirSync(path.join(root, 'backups')).some(name => name.startsWith('pre-migration-'))).toBe(true);
    const coach = migrated.prepare('SELECT headline,updated_at FROM activity_coach_summaries WHERE activity_id=?').get(benchmark.id);
    migrated.close();
    const reopened = openDatabase(file);
    expect(reopened.prepare('SELECT headline,updated_at FROM activity_coach_summaries WHERE activity_id=?').get(benchmark.id)).toEqual(coach);
    reopened.close();
  });

  it('checkpoints legacy column additions and does not rerun them on reopen', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-schema-migration-'));
    roots.push(root);
    const file = path.join(root, 'legacy.db');
    const legacy = new Database(file);
    legacy.exec("CREATE TABLE activities (id TEXT PRIMARY KEY, start_time TEXT NOT NULL, run_type TEXT, notes TEXT)");
    legacy.close();

    const previousDefer = process.env.AEROLAB_DEFER_MIGRATIONS;
    process.env.AEROLAB_DEFER_MIGRATIONS = '1';
    try {
      const first = openDatabase(file);
      const firstColumns = first.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>;
      expect(firstColumns.some(column => column.name === 'weather_source')).toBe(true);
      expect(firstColumns.some(column => column.name === 'notes')).toBe(false);
      expect(first.prepare("SELECT 1 FROM schema_migrations WHERE name = 'schema-columns-v1'").get()).toBeTruthy();
      first.close();

      const reopened = openDatabase(file);
      expect(reopened.prepare("SELECT count(*) AS count FROM schema_migrations WHERE name = 'schema-columns-v1'").get()).toEqual({ count: 1 });
      reopened.close();
    } finally {
      if (previousDefer === undefined) delete process.env.AEROLAB_DEFER_MIGRATIONS;
      else process.env.AEROLAB_DEFER_MIGRATIONS = previousDefer;
    }
  });

  it('adds weather PM2.5 to databases that already completed the older column migration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-weather-migration-'));
    roots.push(root);
    const file = path.join(root, 'legacy.db');
    const legacy = new Database(file);
    legacy.exec(fs.readFileSync(path.resolve('src/backend/db/schema.sql'), 'utf8'));
    legacy.exec(`
      ALTER TABLE activities DROP COLUMN weather_pm25_ug_m3;
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO schema_migrations (name) VALUES ('schema-columns-v1');
    `);
    legacy.close();

    const previousDefer = process.env.AEROLAB_DEFER_MIGRATIONS;
    process.env.AEROLAB_DEFER_MIGRATIONS = '1';
    try {
      const migrated = openDatabase(file);
      const columns = migrated.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>;
      expect(columns.some(column => column.name === 'weather_pm25_ug_m3')).toBe(true);
      expect(migrated.prepare("SELECT 1 FROM schema_migrations WHERE name = 'weather-pm25-v1'").get()).toBeTruthy();
      migrated.close();
    } finally {
      if (previousDefer === undefined) delete process.env.AEROLAB_DEFER_MIGRATIONS;
      else process.env.AEROLAB_DEFER_MIGRATIONS = previousDefer;
    }
  });
  it('upgrades threshold provenance and date-specific analysis once with a safety snapshot', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-history-migration-'));
    roots.push(root);
    const file = path.join(root, 'runs.db');
    const first = openDatabase(file);
    first.prepare("UPDATE athlete_profile SET age=26,dob=NULL,max_hr=190,resting_hr=50,is_max_hr_estimated=1 WHERE id='primary'").run();
    const trace = workoutTrace([{ seconds: 2400, hr: 165 }], { id: 'history', date: '2026-01-02' });
    expect(importRunContent(first, traceCsv(trace), 'run.csv').status).toBe('imported');
    first.prepare("UPDATE activities SET run_type='easy_base',auto_run_type='easy_base',z4_seconds=0").run();
    first.exec('ALTER TABLE physiological_thresholds DROP COLUMN source_kind');
    first.prepare("DELETE FROM schema_migrations WHERE name IN ('threshold-source-kind-v1','historical-fitness-v1')").run();
    first.close();
    const migrated = openDatabase(file);
    expect(migrated.prepare('SELECT run_type,z4_seconds FROM activities').get()).toEqual({ run_type: 'threshold_lt2', z4_seconds: 2400 });
    expect(migrated.prepare('SELECT source_kind FROM physiological_thresholds').get()).toEqual({ source_kind: 'workout' });
    expect(migrated.prepare("SELECT 1 FROM schema_migrations WHERE name='historical-fitness-v1'").get()).toBeTruthy();
    expect(fs.readdirSync(path.join(root, 'backups')).some(name => name.startsWith('pre-migration-'))).toBe(true);
    const coach = migrated.prepare('SELECT updated_at FROM activity_coach_summaries').get();
    migrated.close();
    const reopened = openDatabase(file);
    expect(reopened.prepare('SELECT updated_at FROM activity_coach_summaries').get()).toEqual(coach);
    reopened.close();
  });

});
