import { migrateCompression } from '../compression.js';
import { loadAnalysisRecords } from '../analysis-records.js';
import type Database from 'better-sqlite3';
import { getAthleteHeartRateProfile } from '../../physiology/athlete-profile.js';
import { extractSteadyStateMetrics, calculateEconomy } from '../../physiology/economy.js';
import { syncAllCoachSummaries } from '../../physiology/coach-summary.js';
import { calculateActivityTrainingLoad } from '../../physiology/training-load.js';
import { realignDatabase } from '../realign.js';
import { continuousRaceEffort } from '../../ingestion/continuous-effort.js';
import { deduplicateRuns } from '../deduplicate.js';
import { logger } from '../../utils/logger.js';
import type { createMigrationRunner } from '../migrations.js';

type Runner = ReturnType<typeof createMigrationRunner>;

export const ANALYSIS_UPGRADES = ['signal-classification-v1', 'effort-structure-v1', 'stride-recovery-v1', 'historical-fitness-v1', 'recovery-hrr-v1', 'fit-structure-v1', 'analysis-telemetry-policy-v1', 'structured-tempo-v1', 'coaching-prose-v1', 'coaching-running-evidence-v1'] as const;

/** Essential compatibility changes always run before scheduling analysis. */
export function runSchemaMigrations(db: Database.Database, migrations: Runner): void {
  const steps: Array<{ id: string; apply: () => void }> = [];
  const register = (id: string, apply: () => void) => { steps.push({ id, apply }); };
  register('threshold-source-kind-v1', () => {
    const columns = db.prepare('PRAGMA table_info(physiological_thresholds)').all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'source_kind'))
      db.exec("ALTER TABLE physiological_thresholds ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'workout'");
  });

  register('fit-telemetry-v2', () => {
    const existing = new Set((db.prepare('PRAGMA table_info(activity_records)').all() as Array<{ name: string }>).map(column => column.name));
    for (const name of ['power_w', 'vertical_ratio', 'stance_time_balance', 'step_length_m', 'respiration_rate', 'core_temperature_c', 'fractional_cadence']) {
      if (!existing.has(name)) db.exec(`ALTER TABLE activity_records ADD COLUMN ${name} REAL`);
    }
    if (!existing.has('fit_fields_json')) db.exec('ALTER TABLE activity_records ADD COLUMN fit_fields_json TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS activity_fit_details (
      activity_id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL, source_fit BLOB,
      FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
    )`);
  });

  register('confirmed-workout-intent-v1', () => {
    const columns = new Set((db.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(column => column.name));
    if (!columns.has('manual_run_type')) db.exec('ALTER TABLE activities ADD COLUMN manual_run_type TEXT');
    if (!columns.has('manual_failed_workout')) db.exec('ALTER TABLE activities ADD COLUMN manual_failed_workout INTEGER');
    // Earlier versions represented an override by keeping the two labels apart.
    if (columns.has('auto_run_type')) db.exec(`UPDATE activities SET manual_run_type = run_type
      WHERE manual_run_type IS NULL AND auto_run_type IS NOT NULL AND run_type <> auto_run_type`);
  });

  // Essential schema upgrades are checkpointed separately from derived-data work.
  register('schema-columns-v1', () => {
    const addMissing = (table: string, columns: Array<[string, string]>): void => {
      const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name));
      for (const [name, definition] of columns) {
        if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      }
    };
    addMissing('activities', [
      ['steady_pace_sec_km', 'REAL'], ['steady_heart_rate', 'INTEGER'], ['steady_cadence', 'INTEGER'],
      ['steady_stance_time', 'REAL'], ['pause_duration_seconds', 'REAL DEFAULT 0'],
      ['walk_duration_seconds', 'REAL DEFAULT 0'], ['walk_distance_meters', 'REAL DEFAULT 0'],
      ['weather_temperature_c', 'REAL'], ['weather_humidity_pct', 'INTEGER'], ['weather_apparent_temp_c', 'REAL'],
      ['weather_pm25_ug_m3', 'REAL'], ['weather_pm25_source', 'TEXT'],
      ['weather_condition', 'TEXT'], ['weather_code', 'INTEGER'], ['weather_fetched_at', 'TEXT'],
      ['weather_source', 'TEXT'], ['training_load', 'REAL'], ['z1_seconds', 'INTEGER DEFAULT 0'],
      ['z2_seconds', 'INTEGER DEFAULT 0'], ['z3_seconds', 'INTEGER DEFAULT 0'],
      ['z4_seconds', 'INTEGER DEFAULT 0'], ['z5_seconds', 'INTEGER DEFAULT 0']
    ]);
    addMissing('activity_intervals', [
      ['peak_cadence', 'INTEGER'], ['peak_speed_mps', 'REAL'], ['peak_pace_sec_km', 'REAL'],
      ['min_stance_time', 'REAL'], ['hr_drop', 'INTEGER'], ['avg_vert_osc', 'REAL'],
      ['avg_stance_time', 'REAL'], ['avg_step_length', 'REAL'], ['avg_stride_length', 'REAL'], ['avg_vert_ratio', 'REAL']
    ]);
    addMissing('activity_splits', [
      ['avg_cadence', 'INTEGER'], ['avg_stance_time', 'REAL'], ['avg_vert_osc', 'REAL'], ['avg_vert_ratio', 'REAL']
    ]);
    addMissing('athlete_profile', [
      ['is_configured', 'INTEGER DEFAULT 0'], ['gender', "TEXT DEFAULT 'Prefer not to say'"],
      ['is_max_hr_estimated', 'INTEGER DEFAULT 0'], ['lt1_hr', 'INTEGER'], ['lt2_hr', 'INTEGER'],
      ['lt1_min_hr', 'INTEGER'], ['lt1_max_hr', 'INTEGER'], ['name', "TEXT DEFAULT 'Runner'"]
    ]);
    addMissing('activity_coach_summaries', [
      ['score_breakdown_json', 'TEXT'], ['analysis_json', 'TEXT'], ['insight_tones_json', 'TEXT']
    ]);
    const activityColumns = new Set((db.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(column => column.name));
    if (activityColumns.has('notes')) db.exec('ALTER TABLE activities DROP COLUMN notes');
  });

  // Keep additions to an already completed schema migration in a new step.
  // Existing databases have schema-columns-v1 recorded, so editing that step
  // alone would leave them without columns introduced by later releases.
  register('weather-pm25-v1', () => {
    const existing = new Set((db.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(column => column.name));
    if (!existing.has('weather_pm25_ug_m3')) db.exec('ALTER TABLE activities ADD COLUMN weather_pm25_ug_m3 REAL');
  });

  register('weather-pm25-source-v1', () => {
    const existing = new Set((db.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(column => column.name));
    if (!existing.has('weather_pm25_source')) db.exec('ALTER TABLE activities ADD COLUMN weather_pm25_source TEXT');
  });

  register('lossless-fit-gzip-v1', () => migrateCompression(db));

  for (const step of steps) migrations.run(step.id, step.apply);
}

/** Distinct data changes retain their checkpoints and snapshot/rollback behavior. */
export function runDerivedMigrations(db: Database.Database, migrations: Runner): void {
  const steps: Array<{ id: string; apply: () => void }> = [];
  const register = (id: string, apply: () => void) => { steps.push({ id, apply }); };
  // Automatic backfill: compute core centroid for any existing runs missing workout coordinates
  register('centroid-v1', () => {
    const unbackfilled = db.prepare('SELECT id, duration_seconds FROM activities WHERE workout_lat IS NULL').all() as any[];
    for (const act of unbackfilled) {
      const warmupCutoff = Math.min(300, (act.duration_seconds || 0) * 0.2);
      const cooldownCutoff = Math.max(warmupCutoff, (act.duration_seconds || 0) - Math.min(300, (act.duration_seconds || 0) * 0.15));
      const records = db.prepare(
        'SELECT lat, lon FROM activity_records WHERE activity_id = ? AND elapsed_seconds >= ? AND elapsed_seconds <= ? AND lat IS NOT NULL'
      ).all(act.id, warmupCutoff, cooldownCutoff) as any[];

      const targetRecords = records.length > 0
        ? records
        : db.prepare('SELECT lat, lon FROM activity_records WHERE activity_id = ? AND lat IS NOT NULL').all(act.id) as any[];

      if (targetRecords.length > 0) {
        const sumLat = targetRecords.reduce((s, r) => s + r.lat, 0);
        const sumLon = targetRecords.reduce((s, r) => s + r.lon, 0);
        const avgLat = Number((sumLat / targetRecords.length).toFixed(6));
        const avgLon = Number((sumLon / targetRecords.length).toFixed(6));
        db.prepare('UPDATE activities SET workout_lat = ?, workout_lon = ? WHERE id = ?').run(avgLat, avgLon, act.id);
      }
    }
  });

  // Automatic backfill: compute steady state & pause isolation for existing runs
  register('steady-state-v1', () => {
    const unbackfilledSteady = db.prepare('SELECT id FROM activities WHERE steady_pace_sec_km IS NULL OR steady_pace_sec_km < 100').all() as any[];
    for (const act of unbackfilledSteady) {
      const records = db.prepare('SELECT * FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(act.id);
      if (records.length > 0) {
        const bd = extractSteadyStateMetrics(records);
        db.prepare(`
          UPDATE activities SET
            steady_pace_sec_km = ?,
            steady_heart_rate = ?,
            steady_cadence = ?,
            steady_stance_time = ?,
            pause_duration_seconds = ?,
            walk_duration_seconds = ?,
            walk_distance_meters = ?
          WHERE id = ?
        `).run(
          bd.steadyPaceSecKm,
          bd.steadyHeartRate,
          bd.steadyCadence,
          bd.steadyStanceTimeMs,
          bd.stopDurationSeconds,
          bd.walkDurationSeconds,
          bd.walkDistanceMeters,
          act.id
        );
      }
    }
  });

  // Recompute aerobic_decoupling_pct for all activities using the corrected warmup-skipping algorithm.
  // This ensures existing runs pick up the fix without needing re-import.
  register('decoupling-v1', () => {
    const allActivities = db.prepare('SELECT id FROM activities').all() as any[];
    for (const act of allActivities) {
      const records = db.prepare('SELECT * FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(act.id);
      if (records.length > 10) {
        const economy = calculateEconomy(records as any);
        if (economy.aerobicDecouplingPct !== null) {
          db.prepare('UPDATE activities SET aerobic_decoupling_pct = ? WHERE id = ?')
            .run(economy.aerobicDecouplingPct, act.id);
        }
      }
    }
  });

  // Ensure activity_coach_summaries table exists and auto-backfill on initialization
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_coach_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_id TEXT UNIQUE NOT NULL,
        headline TEXT NOT NULL,
        effectiveness_score INTEGER NOT NULL,
        key_insights_json TEXT NOT NULL,
        insight_tones_json TEXT,
        recommendation TEXT NOT NULL,
        steady_pace_sec_km REAL,
        steady_heart_rate INTEGER,
        steady_cadence INTEGER,
        steady_stance_time REAL,
        pause_breakdown_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_coach_summaries_activity ON activity_coach_summaries(activity_id);
    `);

    // Backfill any existing activities not yet in activity_coach_summaries
    const unsummarized = db.prepare(`
      SELECT a.id FROM activities a
      LEFT JOIN activity_coach_summaries s ON a.id = s.activity_id
      WHERE s.id IS NULL
    `).all() as Array<{ id: string }>;

    register('coach-summaries-v1', () => {
      if (unsummarized.length > 0) syncAllCoachSummaries(db);
    });


    // Automatically backfill training_load and zone duration seconds for existing activities
    register('training-load-v1', () => {
      const unbackfilledLoad = db.prepare('SELECT id, duration_seconds, avg_heart_rate FROM activities WHERE training_load IS NULL').all() as Array<{ id: string; duration_seconds: number | null; avg_heart_rate: number | null }>;
      if (unbackfilledLoad.length > 0) {
        const hrProfile = getAthleteHeartRateProfile(db);
        const updateLoadStmt = db.prepare(`
          UPDATE activities SET
            training_load = ?,
            z1_seconds = ?,
            z2_seconds = ?,
            z3_seconds = ?,
            z4_seconds = ?,
            z5_seconds = ?
          WHERE id = ?
        `);
        for (const act of unbackfilledLoad) {
          const records = loadAnalysisRecords(db, act.id);
          const res = calculateActivityTrainingLoad(records, hrProfile, {
            durationSeconds: act.duration_seconds,
            avgHeartRate: act.avg_heart_rate
          });
          updateLoadStmt.run(
            res.trainingLoad,
            res.zones.z1Seconds,
            res.zones.z2Seconds,
            res.zones.z3Seconds,
            res.zones.z4Seconds,
            res.zones.z5Seconds,
            act.id
          );
        }
      }
    });

    // One-time data migration. Recomputing every activity on each open makes
    // startup and restore proportional to the size of the workout history.
    register('realign-v1', () => {
      deduplicateRuns(db, (msg) => logger.info('DB', `[dedup] ${msg}`));
      const result = realignDatabase(db, { logger: (msg) => logger.info('DB', `[realign] ${msg}`) });
      if (result.activitiesFailed.length > 0) throw new Error(`${result.activitiesFailed.length} activities failed to realign`);
      db.pragma('user_version = 1');
    });

    register('continuous-race-v1', () => {
      const profile = getAthleteHeartRateProfile(db);
      const candidates = db.prepare("SELECT id FROM activities WHERE run_type IS NULL OR run_type <> 'race'").all() as { id: string }[];
      const activityIds = candidates.filter(activity => {
        return continuousRaceEffort(loadAnalysisRecords(db, activity.id), profile);
      }).map(activity => activity.id);
      if (activityIds.length === 0) return;
      const result = realignDatabase(db, { activityIds });
      if (result.activitiesFailed.length > 0) throw new Error(`${result.activitiesFailed.length} continuous efforts failed to realign`);
    });

    for (const step of steps) migrations.run(step.id, step.apply);
    // These historical algorithm checkpoints all request the current full replay.
    // Complete them in one transaction and one pass; retain every legacy ID.
    migrations.runGroup(ANALYSIS_UPGRADES, () => {
      const result = realignDatabase(db, { strict: true });
      if (result.activitiesFailed.length) throw new Error(`Analysis refresh failed: ${result.activitiesFailed.join('; ')}`);
    });
  } catch (err: any) {
    // Migrations are non-fatal so a bad row cannot block startup, but the failure
    // must be visible — this previously swallowed errors silently (see audit).
    logger.error('DB', 'Startup migration pass failed; database may be stale', err);
  }

}
