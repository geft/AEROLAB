import { getAthleteHeartRateProfile } from '../physiology/athlete-profile.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractSteadyStateMetrics, calculateEconomy } from '../physiology/economy.js';
import { syncAllCoachSummaries } from '../physiology/coach-summary.js';
import { syncAllActivitiesWeather } from '../physiology/weather.js';
import { calculateActivityTrainingLoad } from '../physiology/training-load.js';
import { realignDatabase } from './realign.js';
import { deduplicateRuns } from './deduplicate.js';
import { logger } from '../utils/logger.js';

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

  const targetPath = dbPath || process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'runs.db');
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

  // Ensure new columns exist
  try {
    const cols = db.prepare("PRAGMA table_info(activities)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('steady_pace_sec_km')) db.exec("ALTER TABLE activities ADD COLUMN steady_pace_sec_km REAL");
    if (!colNames.has('steady_heart_rate')) db.exec("ALTER TABLE activities ADD COLUMN steady_heart_rate INTEGER");
    if (!colNames.has('steady_cadence')) db.exec("ALTER TABLE activities ADD COLUMN steady_cadence INTEGER");
    if (!colNames.has('steady_stance_time')) db.exec("ALTER TABLE activities ADD COLUMN steady_stance_time REAL");
    if (!colNames.has('pause_duration_seconds')) db.exec("ALTER TABLE activities ADD COLUMN pause_duration_seconds REAL DEFAULT 0");
    if (!colNames.has('walk_duration_seconds')) db.exec("ALTER TABLE activities ADD COLUMN walk_duration_seconds REAL DEFAULT 0");
    if (!colNames.has('walk_distance_meters')) db.exec("ALTER TABLE activities ADD COLUMN walk_distance_meters REAL DEFAULT 0");
    if (!colNames.has('weather_temperature_c')) db.exec("ALTER TABLE activities ADD COLUMN weather_temperature_c REAL");
    if (!colNames.has('weather_humidity_pct')) db.exec("ALTER TABLE activities ADD COLUMN weather_humidity_pct INTEGER");
    if (!colNames.has('weather_apparent_temp_c')) db.exec("ALTER TABLE activities ADD COLUMN weather_apparent_temp_c REAL");
    if (!colNames.has('weather_condition')) db.exec("ALTER TABLE activities ADD COLUMN weather_condition TEXT");
    if (!colNames.has('weather_code')) db.exec("ALTER TABLE activities ADD COLUMN weather_code INTEGER");
    if (!colNames.has('weather_fetched_at')) db.exec("ALTER TABLE activities ADD COLUMN weather_fetched_at TEXT");
    if (!colNames.has('training_load')) db.exec("ALTER TABLE activities ADD COLUMN training_load REAL");
    if (!colNames.has('z1_seconds')) db.exec("ALTER TABLE activities ADD COLUMN z1_seconds INTEGER DEFAULT 0");
    if (!colNames.has('z2_seconds')) db.exec("ALTER TABLE activities ADD COLUMN z2_seconds INTEGER DEFAULT 0");
    if (!colNames.has('z3_seconds')) db.exec("ALTER TABLE activities ADD COLUMN z3_seconds INTEGER DEFAULT 0");
    if (!colNames.has('z4_seconds')) db.exec("ALTER TABLE activities ADD COLUMN z4_seconds INTEGER DEFAULT 0");
    if (!colNames.has('z5_seconds')) db.exec("ALTER TABLE activities ADD COLUMN z5_seconds INTEGER DEFAULT 0");

    // Notes were removed as a feature, so drop the column rather than leave a
    // write-only field that nothing displays.
    if (colNames.has('notes')) db.exec('ALTER TABLE activities DROP COLUMN notes');
  } catch (err) {
    // Non-fatal if table not created yet
  }

  // Ensure activity_intervals columns exist (CREATE TABLE IF NOT EXISTS won't add new columns)
  try {
    const intCols = db.prepare("PRAGMA table_info(activity_intervals)").all() as Array<{ name: string }>;
    const intColNames = new Set(intCols.map(c => c.name));
    if (!intColNames.has('peak_cadence')) db.exec("ALTER TABLE activity_intervals ADD COLUMN peak_cadence INTEGER");
    if (!intColNames.has('peak_speed_mps')) db.exec("ALTER TABLE activity_intervals ADD COLUMN peak_speed_mps REAL");
    if (!intColNames.has('peak_pace_sec_km')) db.exec("ALTER TABLE activity_intervals ADD COLUMN peak_pace_sec_km REAL");
    if (!intColNames.has('min_stance_time')) db.exec("ALTER TABLE activity_intervals ADD COLUMN min_stance_time REAL");
    if (!intColNames.has('hr_drop')) db.exec("ALTER TABLE activity_intervals ADD COLUMN hr_drop INTEGER");
    if (!intColNames.has('avg_vert_osc')) db.exec("ALTER TABLE activity_intervals ADD COLUMN avg_vert_osc REAL");
    if (!intColNames.has('avg_stance_time')) db.exec("ALTER TABLE activity_intervals ADD COLUMN avg_stance_time REAL");
    if (!intColNames.has('avg_step_length')) db.exec("ALTER TABLE activity_intervals ADD COLUMN avg_step_length REAL");
    if (!intColNames.has('avg_stride_length')) db.exec("ALTER TABLE activity_intervals ADD COLUMN avg_stride_length REAL");
    if (!intColNames.has('avg_vert_ratio')) db.exec("ALTER TABLE activity_intervals ADD COLUMN avg_vert_ratio REAL");
  } catch (err) {
    // Non-fatal if table not created yet
  }

  // Ensure activity_splits biomechanics columns exist
  try {
    const splitCols = db.prepare("PRAGMA table_info(activity_splits)").all() as Array<{ name: string }>;
    const splitColNames = new Set(splitCols.map(c => c.name));
    if (!splitColNames.has('avg_cadence')) db.exec("ALTER TABLE activity_splits ADD COLUMN avg_cadence INTEGER");
    if (!splitColNames.has('avg_stance_time')) db.exec("ALTER TABLE activity_splits ADD COLUMN avg_stance_time REAL");
    if (!splitColNames.has('avg_vert_osc')) db.exec("ALTER TABLE activity_splits ADD COLUMN avg_vert_osc REAL");
    if (!splitColNames.has('avg_vert_ratio')) db.exec("ALTER TABLE activity_splits ADD COLUMN avg_vert_ratio REAL");
  } catch (err) {
    // Non-fatal if table not created yet
  }

  // Ensure athlete_profile columns exist
  try {
    const profCols = db.prepare("PRAGMA table_info(athlete_profile)").all() as Array<{ name: string }>;
    const profColNames = new Set(profCols.map(c => c.name));
    if (!profColNames.has('is_configured')) db.exec("ALTER TABLE athlete_profile ADD COLUMN is_configured INTEGER DEFAULT 0");
    if (!profColNames.has('gender')) db.exec("ALTER TABLE athlete_profile ADD COLUMN gender TEXT DEFAULT 'Prefer not to say'");
    if (!profColNames.has('is_max_hr_estimated')) db.exec("ALTER TABLE athlete_profile ADD COLUMN is_max_hr_estimated INTEGER DEFAULT 0");
  } catch (err) {
    // Non-fatal
  }

  // Automatic backfill: compute core centroid for any existing runs missing workout coordinates
  try {
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
  } catch (err) {
    // Non-fatal if tables are new or empty
  }

  // Automatic backfill: compute steady state & pause isolation for existing runs
  try {
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
  } catch (err) {
    // Non-fatal if table new or empty
  }

  // Recompute aerobic_decoupling_pct for all activities using the corrected warmup-skipping algorithm.
  // This ensures existing runs pick up the fix without needing re-import.
  try {
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
  } catch (err) {
    // Non-fatal
  }

  // A fresh profile contains no personal measurements or training history.
  const profileColumns = db.prepare('PRAGMA table_info(athlete_profile)').all() as Array<{ name: string }>;
  const profileColumnNames = new Set(profileColumns.map(c => c.name));
  for (const column of ['lt1_hr', 'lt2_hr', 'lt1_min_hr', 'lt1_max_hr']) {
    if (!profileColumnNames.has(column)) db.exec(`ALTER TABLE athlete_profile ADD COLUMN ${column} INTEGER`);
  }
  if (!profileColumnNames.has('name')) db.exec("ALTER TABLE athlete_profile ADD COLUMN name TEXT DEFAULT 'Runner'");
  if (!profileColumnNames.has('gender')) db.exec("ALTER TABLE athlete_profile ADD COLUMN gender TEXT DEFAULT 'Prefer not to say'");
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

    // Ensure score_breakdown_json exists on older databases
    const coachCols = db.prepare("PRAGMA table_info(activity_coach_summaries)").all() as Array<{ name: string }>;
    const coachColNames = new Set(coachCols.map(c => c.name));
    if (!coachColNames.has('score_breakdown_json')) {
      db.exec("ALTER TABLE activity_coach_summaries ADD COLUMN score_breakdown_json TEXT");
    }

    // Backfill any existing activities not yet in activity_coach_summaries
    const unsummarized = db.prepare(`
      SELECT a.id FROM activities a
      LEFT JOIN activity_coach_summaries s ON a.id = s.activity_id
      WHERE s.id IS NULL
    `).all() as Array<{ id: string }>;

    if (unsummarized.length > 0) {
      syncAllCoachSummaries(db);
    }

    // Automatically backfill microclimate weather for activities missing ambient weather data
    if (!validateSchema) syncAllActivitiesWeather(db).catch(() => {});

    // Automatically backfill training_load and zone duration seconds for existing activities
    try {
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
    } catch (err: any) {
      // Backfilling training load is best-effort, but a silent failure used to
      // leave stale load/zone data with no trace. Log it instead.
      logger.warn('DB', 'Training-load/zone backfill skipped', { error: err?.message || String(err) });
    }

    // Automatic migration: Deduplicate runs imported across different formats (FIT vs CSV)
    deduplicateRuns(db, (msg) => logger.info('DB', `[dedup] ${msg}`));
    // Automatic migration: Re-classify and re-detect intervals with updated physiological definitions
    // (also prunes stale threshold rows, re-syncs profile + coach summaries)
    realignDatabase(db, { logger: (msg) => logger.info('DB', `[realign] ${msg}`) });
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
