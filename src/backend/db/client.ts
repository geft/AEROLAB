import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractSteadyStateMetrics, calculateEconomy } from '../physiology/economy.js';
import { syncAllCoachSummaries } from '../physiology/coach-summary.js';
import { syncAllActivitiesWeather } from '../physiology/weather.js';
import { detectIntervals } from '../ingestion/interval-detector.js';
import { classifyRun } from '../ingestion/classifier.js';
import { evaluateThresholdUpdate } from '../physiology/threshold-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (dbInstance && !dbPath) {
    return dbInstance;
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
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
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
  } catch (err) {
    // Non-fatal if table not created yet
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
        dob TEXT DEFAULT '1989-04',
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
          'primary', 37, '1989-04', 165, 55, 55, 203,
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
      // Update existing record if it had older generic defaults
      db.prepare(`
        UPDATE athlete_profile SET
          lt1_hr = COALESCE(lt1_hr, 148),
          lt2_hr = COALESCE(lt2_hr, 167),
          lt1_min_hr = COALESCE(lt1_min_hr, 147),
          lt1_max_hr = COALESCE(lt1_max_hr, 149),
          z3_start_hr = CASE WHEN z3_start_hr = 160 THEN 149 ELSE z3_start_hr END,
          z4_start_hr = CASE WHEN z4_start_hr = 175 THEN 167 ELSE z4_start_hr END
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

    // Automatic migration: Re-classify and re-detect intervals with updated physiological definitions
    const allActivities = db.prepare('SELECT * FROM activities').all() as any[];
    for (const act of allActivities) {
      const records = db.prepare('SELECT * FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(act.id) as any[];
      if (records.length > 30) {
        const mappedRecords = records.map(r => ({
          timestamp: r.timestamp,
          elapsedSeconds: r.elapsed_seconds,
          heartRate: r.heart_rate,
          cadence: r.cadence,
          speedMps: r.speed_mps,
          distanceMeters: r.distance_m,
          altitudeMeters: r.altitude_m,
          latitude: r.lat,
          longitude: r.lon,
          temperature: r.temp,
          verticalOscillation: r.vert_osc,
          stanceTime: r.stance_time
        }));

        const intervals = detectIntervals(mappedRecords as any);

        db.prepare('DELETE FROM activity_intervals WHERE activity_id = ?').run(act.id);
        const insertInterval = db.prepare(`
          INSERT INTO activity_intervals (
            activity_id, interval_index, type, start_seconds, duration_seconds,
            distance_meters, avg_speed_mps, avg_pace_sec_km, avg_heart_rate,
            max_heart_rate, avg_cadence, peak_cadence, peak_speed_mps, peak_pace_sec_km,
            min_stance_time, hr_drop
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const inv of intervals) {
          insertInterval.run(
            act.id, inv.intervalIndex, inv.type, inv.startSeconds, inv.durationSeconds,
            inv.distanceMeters, inv.avgSpeedMps, inv.avgPaceSecKm, inv.avgHeartRate,
            inv.maxHeartRate, inv.avgCadence, inv.peakCadence ?? null, inv.peakSpeedMps ?? null,
            inv.peakPaceSecKm ?? null, inv.minStanceTime ?? null, inv.hrDrop ?? null
          );
        }

        const economy = calculateEconomy(mappedRecords as any);
        const meta = {
          id: act.id,
          name: act.name,
          sport: act.sport,
          date: act.start_time,
          totalDistanceMeters: act.distance_meters,
          totalDurationSeconds: act.duration_seconds,
          totalElapsedSeconds: act.elapsed_seconds || act.duration_seconds,
          avgHeartRate: act.avg_heart_rate,
          maxHeartRate: act.max_heart_rate,
          avgCadence: act.avg_cadence,
          maxCadence: act.max_cadence,
          calories: act.calories,
          totalAscentMeters: act.elevation_gain_m || 0,
          totalDescentMeters: act.elevation_loss_m || 0
        };

        const classification = classifyRun(meta, mappedRecords as any, economy, intervals);

        const initialTags: string[] = [];
        if (classification.runType === 'easy_base') initialTags.push('Easy Base');
        else if (classification.runType === 'threshold_lt2') initialTags.push('Threshold');
        else if (classification.runType === 'intervals_vo2') initialTags.push('VO2 Max');
        else if (classification.runType === 'long_run') initialTags.push('Long Run');
        else if (classification.runType === 'recovery') initialTags.push('Recovery');
        else if (classification.runType === 'race') initialTags.push('Race');

        const nameLower = (act.name || '').toLowerCase();
        const hasMpBlocks =
          classification.runType === 'long_run' &&
          (intervals.some(i => i.type === 'work' && i.durationSeconds >= 600 && i.avgHeartRate >= 148 && i.avgHeartRate <= 165) ||
            nameLower.includes('marathon pace') || nameLower.includes('mp'));
        if (hasMpBlocks && !initialTags.includes('Marathon Pace')) {
          initialTags.push('Marathon Pace');
        }

        if (nameLower.includes('tempo') && !initialTags.includes('Tempo')) {
          initialTags.push('Tempo');
        }

        const hasStrides = intervals.some(i => i.type === 'stride') || nameLower.includes('stride');
        if (hasStrides && !initialTags.includes('Strides')) {
          initialTags.push('Strides');
        }

        if (classification.isFailedWorkout && !initialTags.includes('Failed Workout')) {
          initialTags.push('Failed Workout');
        }

        db.prepare(`
          UPDATE activities SET
            run_type = ?,
            auto_run_type = ?,
            tags = ?
          WHERE id = ?
        `).run(classification.runType, classification.runType, JSON.stringify(initialTags), act.id);

        evaluateThresholdUpdate(db, act.id, act.start_time, classification.runType, meta, mappedRecords as any, economy);
      }
    }

    // Clean up any duplicate calibrations for identical source activities
    db.prepare(`
      DELETE FROM physiological_thresholds
      WHERE id NOT IN (
        SELECT MAX(id) FROM physiological_thresholds GROUP BY source_activity_id
      )
    `).run();

    syncAllCoachSummaries(db);
  } catch (err) {
    // Non-fatal
  }

  if (!dbPath) {
    dbInstance = db;
  }

  return db;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
