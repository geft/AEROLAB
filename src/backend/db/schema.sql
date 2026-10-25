-- SQLite Schema for run-progress local dashboard

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  source_filename TEXT,
  source_file_hash TEXT UNIQUE,
  start_time TEXT NOT NULL,
  name TEXT,
  sport TEXT DEFAULT 'running',
  is_treadmill INTEGER NOT NULL DEFAULT 0,
  run_type TEXT,
  auto_run_type TEXT,
  manual_run_type TEXT,
  manual_failed_workout INTEGER,
  distance_meters REAL,
  duration_seconds REAL,
  elapsed_seconds REAL,
  avg_pace_sec_km REAL,
  avg_heart_rate INTEGER,
  max_heart_rate INTEGER,
  avg_cadence INTEGER,
  max_cadence INTEGER,
  calories INTEGER,
  elevation_gain_m REAL,
  elevation_loss_m REAL,
  avg_temperature REAL,
  avg_vertical_oscillation REAL,
  avg_stance_time REAL,
  efficiency_factor REAL,
  aerobic_decoupling_pct REAL,
  meters_per_beat REAL,
  estimated_lt1_hr INTEGER,
  estimated_lt1_pace_sec_km REAL,
  estimated_lt2_hr INTEGER,
  estimated_lt2_pace_sec_km REAL,
  workout_lat REAL,
  workout_lon REAL,
  steady_pace_sec_km REAL,
  steady_heart_rate INTEGER,
  steady_cadence INTEGER,
  steady_stance_time REAL,
  pause_duration_seconds REAL DEFAULT 0,
  walk_duration_seconds REAL DEFAULT 0,
  walk_distance_meters REAL DEFAULT 0,
  official_time_seconds REAL,
  official_distance_meters REAL,
  official_source TEXT,
  weather_temperature_c REAL,
  weather_humidity_pct INTEGER,
  weather_apparent_temp_c REAL,
  weather_pm25_ug_m3 REAL,
  weather_pm25_source TEXT,
  weather_condition TEXT,
  weather_code INTEGER,
  weather_fetched_at TEXT,
  weather_source TEXT,
  tags TEXT DEFAULT '[]',
  training_load REAL,
  z1_seconds INTEGER DEFAULT 0,
  z2_seconds INTEGER DEFAULT 0,
  z3_seconds INTEGER DEFAULT 0,
  z4_seconds INTEGER DEFAULT 0,
  z5_seconds INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);


CREATE INDEX IF NOT EXISTS idx_activities_start_time ON activities(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_activities_run_type ON activities(run_type);

CREATE TABLE IF NOT EXISTS activity_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id TEXT NOT NULL,
  split_index INTEGER NOT NULL,
  distance_meters REAL,
  duration_seconds REAL,
  avg_pace_sec_km REAL,
  avg_heart_rate INTEGER,
  split_efficiency_factor REAL,
  elevation_change_m REAL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_splits_activity ON activity_splits(activity_id, split_index);

CREATE TABLE IF NOT EXISTS activity_intervals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id TEXT NOT NULL,
  interval_index INTEGER NOT NULL,
  type TEXT NOT NULL, -- 'work' | 'recovery'
  start_seconds REAL,
  duration_seconds REAL,
  distance_meters REAL,
  avg_speed_mps REAL,
  avg_pace_sec_km REAL,
  avg_heart_rate INTEGER,
  max_heart_rate INTEGER,
  avg_cadence INTEGER,
  peak_cadence INTEGER,
  peak_speed_mps REAL,
  peak_pace_sec_km REAL,
  min_stance_time REAL,
  hr_drop INTEGER,
  avg_vert_osc REAL,
  avg_stance_time REAL,
  avg_step_length REAL,
  avg_stride_length REAL,
  avg_vert_ratio REAL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intervals_activity ON activity_intervals(activity_id, interval_index);

CREATE TABLE IF NOT EXISTS activity_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  elapsed_seconds REAL,
  heart_rate INTEGER,
  cadence INTEGER,
  speed_mps REAL,
  distance_m REAL,
  altitude_m REAL,
  lat REAL,
  lon REAL,
  temp REAL,
  vert_osc REAL,
  stance_time REAL,
  power_w REAL,
  vertical_ratio REAL,
  stance_time_balance REAL,
  step_length_m REAL,
  respiration_rate REAL,
  core_temperature_c REAL,
  fractional_cadence REAL,
  fit_fields_json TEXT,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_records_activity ON activity_records(activity_id, elapsed_seconds);

-- Raw record JSON is compressed losslessly in one archive per activity.
CREATE TABLE IF NOT EXISTS activity_record_archives (
  activity_id TEXT PRIMARY KEY,
  fields_gzip BLOB NOT NULL,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

-- Original FIT and additional decoded messages remain local and reprocessable.
-- metadata_json accepts legacy TEXT or gzip BLOB; source_fit uses a version marker.
CREATE TABLE IF NOT EXISTS activity_fit_details (
  activity_id TEXT PRIMARY KEY,
  metadata_json TEXT NOT NULL,
  source_fit BLOB,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS physiological_thresholds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_date TEXT NOT NULL,
  source_activity_id TEXT,
  source_kind TEXT NOT NULL DEFAULT 'workout',
  lt1_hr INTEGER,
  lt1_pace_sec_km REAL,
  lt2_hr INTEGER,
  lt2_pace_sec_km REAL,
  baseline_economy_ef REAL,
  confidence REAL,
  notes TEXT,
  FOREIGN KEY (source_activity_id) REFERENCES activities(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_thresholds_date ON physiological_thresholds(effective_date DESC);

-- Only fields a feature reads. Personal notes (shoes, schedule, goals, routes)
-- were never rendered or computed with, so they are not stored at all.
CREATE TABLE IF NOT EXISTS athlete_profile (
  id TEXT PRIMARY KEY DEFAULT 'primary',
  gender TEXT DEFAULT 'Prefer not to say',
  age INTEGER,
  dob TEXT,
  resting_hr INTEGER,
  max_hr INTEGER,
  is_max_hr_estimated INTEGER DEFAULT 0,
  is_configured INTEGER DEFAULT 0,
  lt1_hr INTEGER,
  lt2_hr INTEGER,
  lt1_min_hr INTEGER,
  lt1_max_hr INTEGER,
  z3_start_hr INTEGER,
  z4_start_hr INTEGER,
  pb_5k TEXT,
  preferences_json TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

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
  score_breakdown_json TEXT,
  analysis_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coach_summaries_activity ON activity_coach_summaries(activity_id);
