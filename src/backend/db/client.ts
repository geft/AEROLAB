import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractSteadyStateMetrics, calculateEconomy } from '../physiology/economy.js';
import { syncAllCoachSummaries } from '../physiology/coach-summary.js';
import { syncAllActivitiesWeather } from '../physiology/weather.js';
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
    } catch {}
    dbInstance = null;
  }

  const targetPath = dbPath || process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'runs.db');

  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(targetPath);
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

  // Ensure athlete_profile table exists and is seeded with runner baseline profile
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS athlete_profile (
        id TEXT PRIMARY KEY DEFAULT 'primary',
        age INTEGER DEFAULT 37,
        dob TEXT DEFAULT '1989-04-15',
        height_cm REAL DEFAULT 165,
        weight_kg REAL DEFAULT 55,
        resting_hr INTEGER DEFAULT 55,
        max_hr INTEGER DEFAULT 203,
        lt1_hr INTEGER DEFAULT 148,
        lt2_hr INTEGER DEFAULT 167,
        lt1_min_hr INTEGER DEFAULT 147,
        lt1_max_hr INTEGER DEFAULT 149,
        z3_start_hr INTEGER DEFAULT 149,
        z4_start_hr INTEGER DEFAULT 167,
        hr_metric TEXT DEFAULT 'HRR',
        vo2_max REAL DEFAULT 58,
        goal_marathon TEXT DEFAULT 'Sub-4 hour at BYD Marathon 2026 (Stretch Goal: 3:40)',
        upcoming_benchmark TEXT DEFAULT '10k Garmin run (October 25)',
        pb_5k TEXT DEFAULT 'Sub 23:00 (April 2026 Time Trial, improved from 31:00)',
        pb_hm TEXT DEFAULT '2:06:00 (Suzhou, 2010)',
        shoe_threshold TEXT DEFAULT 'Li-Ning Feidian 5c',
        shoe_easy TEXT DEFAULT 'Anta Z2',
        shoe_retired TEXT DEFAULT 'Red Hare 8 Pro',
        location TEXT DEFAULT 'Toa Payoh, Singapore',
        favorite_route TEXT DEFAULT 'City -> Ramp -> PCN -> Ramp -> City',
        schedule_json TEXT,
        preferences_json TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure columns exist on older databases
    const profileCols = db.prepare("PRAGMA table_info(athlete_profile)").all() as Array<{ name: string }>;
    const profileColNames = new Set(profileCols.map(c => c.name));
    if (!profileColNames.has('lt1_hr')) db.exec("ALTER TABLE athlete_profile ADD COLUMN lt1_hr INTEGER DEFAULT 148");
    if (!profileColNames.has('lt2_hr')) db.exec("ALTER TABLE athlete_profile ADD COLUMN lt2_hr INTEGER DEFAULT 167");
    if (!profileColNames.has('lt1_min_hr')) db.exec("ALTER TABLE athlete_profile ADD COLUMN lt1_min_hr INTEGER DEFAULT 147");
    if (!profileColNames.has('lt1_max_hr')) db.exec("ALTER TABLE athlete_profile ADD COLUMN lt1_max_hr INTEGER DEFAULT 149");
    if (!profileColNames.has('name')) db.exec("ALTER TABLE athlete_profile ADD COLUMN name TEXT DEFAULT 'GJ'");
    if (!profileColNames.has('gender')) db.exec("ALTER TABLE athlete_profile ADD COLUMN gender TEXT DEFAULT 'Male'");
    if (!profileColNames.has('is_max_hr_estimated')) db.exec("ALTER TABLE athlete_profile ADD COLUMN is_max_hr_estimated INTEGER DEFAULT 0");

    const existingProfile = db.prepare('SELECT id, z3_start_hr FROM athlete_profile WHERE id = ?').get('primary') as any;
    if (!existingProfile) {
      const schedule = {
        monday: '2x15 Pogo Jumps + 90m easy + 2x Strides',
        tuesday: '45m Recovery + Strength Training (24kg KB Bulgarian Split Squat, RDL, Calf/Tibialis)',
        wednesday: '75m Easy',
        thursday: '20m Warm-Up + 3x15min Z4 (90s rest) + 20m Cool-Down',
        friday: '60m Easy',
        saturday: '2hr Long Run: 20m Easy + 3x20m MP (1m break)',
        sunday: 'Rest'
      };
      const preferences = {
        filterGallowayBreaks: true,
        filterRampWalks: true,
        filterTrafficStops: true,
        ignoreRawGarminPace: true,
        primaryTime: '7:00 PM'
      };
      db.prepare(`
        INSERT INTO athlete_profile (
          id, age, dob, height_cm, weight_kg, resting_hr, max_hr,
          lt1_hr, lt2_hr, lt1_min_hr, lt1_max_hr,
          z3_start_hr, z4_start_hr, hr_metric, vo2_max,
          goal_marathon, upcoming_benchmark, pb_5k, pb_hm,
          shoe_threshold, shoe_easy, shoe_retired, location,
          favorite_route, schedule_json, preferences_json
        ) VALUES (
          'primary', 37, '1989-04-15', 165, 55, 55, 203,
          148, 167, 147, 149,
          149, 167, 'HRR', 58,
          'Sub-4 hour at BYD Marathon 2026 (Stretch Goal: 3:40)',
          '10k Garmin run (October 25)',
          'Sub 23:00 (April 2026 Time Trial, improved from 31:00)',
          '2:06:00 (Suzhou, 2010)',
          'Li-Ning Feidian 5c', 'Anta Z2', 'Red Hare 8 Pro', 'Toa Payoh, Singapore',
          'City -> Ramp -> PCN -> Ramp -> City',
          ?, ?
        )
      `).run(JSON.stringify(schedule), JSON.stringify(preferences));
    } else {
      // Ensure zone boundary columns follow the athlete's configured thresholds without clobbering custom values
      db.prepare(`
        UPDATE athlete_profile SET
          lt1_min_hr = COALESCE(lt1_min_hr, lt1_hr - 1),
          lt1_max_hr = COALESCE(lt1_max_hr, lt1_hr + 1),
          z3_start_hr = COALESCE(z3_start_hr, lt1_hr + 1),
          z4_start_hr = COALESCE(z4_start_hr, lt2_hr)
        WHERE id = 'primary'
      `).run();
    }
  } catch (err) {
    // Non-fatal if table cannot be created or already exists
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
    syncAllActivitiesWeather(db).catch(() => {});

    // Automatic migration: Deduplicate runs imported across different formats (FIT vs CSV)
    deduplicateRuns(db, (msg) => logger.info('DB', `[dedup] ${msg}`));

    // Automatic migration: Re-classify and re-detect intervals with updated physiological definitions
    // (also prunes stale threshold rows, re-syncs profile + coach summaries)
    realignDatabase(db, { logger: (msg) => logger.info('DB', `[realign] ${msg}`) });
  } catch (err) {
    // Non-fatal
  }

  // Periodic SQLite query planner & index optimization
  try {
    db.pragma('optimize');
  } catch {}

  dbInstance = db;
  return db;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
