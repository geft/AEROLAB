import type { SessionVerdict } from './session-verdict.js';

/** Wire contract for a workout returned by the local API. */
export interface Activity {
  id: string;
  name: string | null;
  start_time: string;
  sport?: string | null;
  is_treadmill?: boolean;
  run_type: string | null;
  auto_run_type?: string | null;
  distance_meters: number;
  duration_seconds: number;
  elapsed_seconds?: number | null;
  avg_pace_sec_km: number | null;
  avg_heart_rate: number | null;
  max_heart_rate?: number | null;
  avg_cadence: number | null;
  max_cadence?: number | null;
  calories?: number | null;
  elevation_gain_m?: number | null;
  elevation_loss_m?: number | null;
  avg_temperature?: number | null;
  avg_vertical_oscillation?: number | null;
  avg_stance_time?: number | null;
  efficiency_factor?: number | null;
  aerobic_decoupling_pct?: number | null;
  meters_per_beat?: number | null;
  estimated_lt1_hr?: number | null;
  estimated_lt1_pace_sec_km?: number | null;
  estimated_lt2_hr?: number | null;
  estimated_lt2_pace_sec_km?: number | null;
  steady_pace_sec_km?: number | null;
  steady_heart_rate?: number | null;
  steady_cadence?: number | null;
  steady_stance_time?: number | null;
  pause_duration_seconds?: number | null;
  walk_duration_seconds?: number | null;
  walk_distance_meters?: number | null;
  /** Timing-mat result for the race distance, in seconds. */
  official_time_seconds?: number | null;
  /** Certified distance the official time was measured over, in metres. */
  official_distance_meters?: number | null;
  /** Which clock produced the official time. */
  official_source?: 'chip' | 'gun' | null;
  weather_temperature_c?: number | null;
  weather_humidity_pct?: number | null;
  weather_apparent_temp_c?: number | null;
  weather_pm25_ug_m3?: number | null;
  weather_pm25_source?: 'nea-sg' | 'open-meteo' | null;
  weather_condition?: string | null;
  weather_code?: number | null;
  weather_fetched_at?: string | null;
  weather_source?: 'open-meteo' | null;
  workout_lat?: number | null;
  workout_lon?: number | null;
  tags?: string | null;
  training_load?: number | null;
  z1_seconds?: number | null;
  z2_seconds?: number | null;
  z3_seconds?: number | null;
  z4_seconds?: number | null;
  z5_seconds?: number | null;
  created_at?: string;
  effectiveness_score?: number | null;
  verdict?: SessionVerdict;
}
