-- SQLite Schema for run-progress local dashboard

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  source_filename TEXT,
  source_file_hash TEXT UNIQUE,
  start_time TEXT NOT NULL,
  name TEXT,
  sport TEXT DEFAULT 'running',
  run_type TEXT,
  auto_run_type TEXT,
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
  weather_temperature_c REAL,
  weather_humidity_pct INTEGER,
  weather_apparent_temp_c REAL,
  weather_condition TEXT,
  weather_code INTEGER,
  weather_fetched_at TEXT,
  tags TEXT DEFAULT '[]',
  notes TEXT,
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
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_records_activity ON activity_records(activity_id, elapsed_seconds);

CREATE TABLE IF NOT EXISTS physiological_thresholds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_date TEXT NOT NULL,
  source_activity_id TEXT,
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
  score_breakdown_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coach_summaries_activity ON activity_coach_summaries(activity_id);

