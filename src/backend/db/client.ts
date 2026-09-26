import { getAthleteHeartRateProfile } from '../physiology/athlete-profile.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractSteadyStateMetrics, calculateEconomy } from '../physiology/economy.js';
import { syncAllCoachSummaries } from '../physiology/coach-summary.js';
import { calculateActivityTrainingLoad } from '../physiology/training-load.js';
import { realignDatabase } from './realign.js';
import { deduplicateRuns } from './deduplicate.js';
import { logger } from '../utils/logger.js';
import { getDatabasePath } from './path.js';
import { createMigrationRunner } from './migrations.js';

const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : (typeof import.meta !== 'undefined' && import.meta.url ? path.dirname(fileURLToPath(import.meta.url)) : process.cwd());

let dbInstance: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (dbInstance && !dbPath) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch { /* best-effort cleanup: safe to ignore */ }
    dbInstance = null;
  }

  const targetPath = dbPath || getDatabasePath();
  dbInstance = openDatabase(targetPath);
  return dbInstance;
}

// Open an independent connection so restore validation never closes the live database.
export function openDatabase(targetPath: string, validateSchema = false): Database.Database {

  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(targetPath);
  try {
    initializeDatabase(db, validateSchema);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function initializeDatabase(db: Database.Database, validateSchema: boolean): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema
  const candidateSchemaPaths = [
    path.resolve(currentDir, 'schema.sql'),
    path.resolve(currentDir, 'db', 'schema.sql'),
    path.resolve(currentDir, 'src', 'backend', 'db', 'schema.sql'),
    path.resolve(process.cwd(), 'src', 'backend', 'db', 'schema.sql'),
    path.resolve(process.cwd(), 'dist-backend', 'schema.sql')
  ];
  const schemaPath = candidateSchemaPaths.find(p => fs.existsSync(p));
  if (schemaPath) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
  }
  const migrations = createMigrationRunner(db);
  const deferDerivedMigrations = process.env.AEROLAB_DEFER_MIGRATIONS === '1';

  // Essential schema upgrades are checkpointed separately from derived-data work.
  migrations.run('schema-columns-v1', () => {
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
      ['weather_pm25_ug_m3', 'REAL'],
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
  migrations.run('weather-pm25-v1', () => {
    const existing = new Set((db.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(column => column.name));
    if (!existing.has('weather_pm25_ug_m3')) db.exec('ALTER TABLE activities ADD COLUMN weather_pm25_ug_m3 REAL');
  });

  // Automatic backfill: compute core centroid for any existing runs missing workout coordinates
  if (!deferDerivedMigrations) migrations.run('centroid-v1', () => {
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
  if (!deferDerivedMigrations) migrations.run('steady-state-v1', () => {
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
  if (!deferDerivedMigrations) migrations.run('decoupling-v1', () => {
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

  // A fresh profile contains no personal measurements or training history.
  if (!db.prepare("SELECT id FROM athlete_profile WHERE id = 'primary'").get()) {
    // Explicit nulls also override personal DEFAULT clauses in older schemas.
    db.prepare(`INSERT INTO athlete_profile (id, age, dob, height_cm, weight_kg, resting_hr, max_hr,
      lt1_hr, lt2_hr, lt1_min_hr, lt1_max_hr, z3_start_hr, z4_start_hr, vo2_max,
      goal_marathon, upcoming_benchmark, pb_5k, pb_hm, shoe_threshold, shoe_easy, shoe_retired,
      location, favorite_route, schedule_json, preferences_json, is_max_hr_estimated)
      VALUES ('primary', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}', 1)`).run();
  }

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
    const unsummarized = deferDerivedMigrations ? [] : db.prepare(`
      SELECT a.id FROM activities a
      LEFT JOIN activity_coach_summaries s ON a.id = s.activity_id
      WHERE s.id IS NULL
    `).all() as Array<{ id: string }>;

    if (!deferDerivedMigrations) migrations.run('coach-summaries-v1', () => {
      if (unsummarized.length > 0) syncAllCoachSummaries(db);
    });


    // Automatically backfill training_load and zone duration seconds for existing activities
    if (!deferDerivedMigrations) migrations.run('training-load-v1', () => {
      const unbackfilledLoad = db.prepare('SELECT id, duration_seconds, avg_heart_rate FROM activities WHERE training_load IS NULL').all() as any[];
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
        const recSelectStmt = db.prepare('SELECT elapsed_seconds, heart_rate FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC');
        for (const act of unbackfilledLoad) {
          const records = recSelectStmt.all(act.id) as any[];
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
    if (!deferDerivedMigrations) migrations.run('realign-v1', () => {
      deduplicateRuns(db, (msg) => logger.info('DB', `[dedup] ${msg}`));
      const result = realignDatabase(db, { logger: (msg) => logger.info('DB', `[realign] ${msg}`) });
      if (result.activitiesFailed.length > 0) throw new Error(`${result.activitiesFailed.length} activities failed to realign`);
      db.pragma('user_version = 1');
    });
  } catch (err: any) {
    // Migrations are non-fatal so a bad row cannot block startup, but the failure
    // must be visible — this previously swallowed errors silently (see audit).
    logger.error('DB', 'Startup migration pass failed; database may be stale', err);
  }

  // Retire the Google Drive integration: drop any stored OAuth tokens left behind
  // so refresh tokens do not linger on disk once the feature is gone.
  try {
    db.exec('DROP TABLE IF EXISTS google_auth');
    db.exec('DROP TABLE IF EXISTS google_tokens');
  } catch (err: any) {
    logger.debug('DB', 'Legacy auth table cleanup skipped', { error: err?.message || String(err) });
  }

  // Periodic SQLite query planner & index optimization
  try {
    db.pragma('optimize');
  } catch (err: any) {
    logger.debug('DB', 'SQLite optimize() skipped', { error: err?.message || String(err) });
  }

  if (validateSchema) {
    if (!schemaPath) throw new Error('Database schema file is unavailable');
    const reference = new Database(':memory:');
    try {
      reference.exec(fs.readFileSync(schemaPath, 'utf8'));
      const tables = reference.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
      for (const { name } of tables) {
        const columns = reference.prepare('SELECT name FROM pragma_table_info(?)').all(name) as Array<{ name: string }>;
        const actual = new Set((db.prepare('SELECT name FROM pragma_table_info(?)').all(name) as Array<{ name: string }>).map(c => c.name));
        if (columns.some(c => !actual.has(c.name))) throw new Error(`Incompatible database schema: ${name}`);
      }
      if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Database contains invalid foreign key references');
    } finally {
      reference.close();
    }
  }
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
