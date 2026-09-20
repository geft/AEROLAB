/**
 * API response contracts.
 *
 * AEROLAB runs entirely locally: the Express backend and this frontend ship
 * together, so the wire format is an internal contract we own outright. These
 * types are the single source of truth for it — there is no third-party consumer
 * to negotiate with, so the client never needs to fall back to `any`.
 *
 * Field names mirror the SQLite columns the routes select, because the routes
 * return rows largely as-is.
 */

/** A workout row as returned by the list and detail endpoints. */
export interface Activity {
  id: string;
  name: string | null;
  start_time: string;
  sport?: string | null;
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
  weather_temperature_c?: number | null;
  weather_humidity_pct?: number | null;
  weather_apparent_temp_c?: number | null;
  weather_condition?: string | null;
  weather_code?: number | null;
  weather_fetched_at?: string | null;
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
  /** Present on list payloads, supplied by the coach-summary join. */
  effectiveness_score?: number | null;
}

/**
 * A single kilometre split.
 *
 * The numeric fields are non-nullable: the ingestion pipeline only persists a
 * split once it has distance, duration and pace, and the parser drops malformed
 * rows. `null` is reserved for the optional biomechanical metrics.
 */
export interface ActivitySplit {
  id?: number;
  activity_id?: string;
  split_index: number;
  distance_meters: number;
  duration_seconds: number;
  avg_pace_sec_km: number | null;
  avg_heart_rate: number | null;
  split_efficiency_factor: number | null;
  elevation_change_m: number | null;
  avg_cadence?: number | null;
  avg_stance_time?: number | null;
  avg_vert_osc?: number | null;
  avg_vert_ratio?: number | null;
}

/**
 * A detected work, recovery or stride repeat. Distance and duration are always
 * present; the peak/min telemetry fields are optional per interval type.
 */
export interface ActivityInterval {
  id?: number;
  activity_id?: string;
  interval_index: number;
  type: 'work' | 'recovery' | 'stride' | (string & {});
  start_seconds: number;
  duration_seconds: number;
  distance_meters: number;
  avg_speed_mps?: number | null;
  avg_pace_sec_km: number | null;
  avg_heart_rate: number | null;
  max_heart_rate?: number | null;
  avg_cadence?: number | null;
  peak_cadence?: number | null;
  peak_speed_mps?: number | null;
  peak_pace_sec_km?: number | null;
  min_stance_time?: number | null;
  hr_drop?: number | null;
  avg_vert_osc?: number | null;
  avg_stance_time?: number | null;
  avg_step_length?: number | null;
  avg_stride_length?: number | null;
  avg_vert_ratio?: number | null;
}

/** A raw telemetry sample (down-sampled server side). */
export interface ActivityRecord {
  id?: number;
  activity_id?: string;
  timestamp?: string;
  elapsed_seconds: number;
  heart_rate: number | null;
  cadence: number | null;
  speed_mps: number | null;
  /** Alias used by the chart component for the same measurement. */
  speedMps?: number | null;
  distance_m: number | null;
  altitude_m: number | null;
  lat?: number | null;
  lon?: number | null;
  temp?: number | null;
  vert_osc?: number | null;
  stance_time?: number | null;
}

/** One itemised line in the execution score. */
export interface ScoreFactor {
  category: string;
  label: string;
  description?: string;
  points: number;
}

/** The algorithmic coach debrief attached to an activity. */
export interface CoachSummary {
  headline: string;
  effectivenessScore: number;
  rating5?: number;
  stars?: number;
  scoreBreakdown?: ScoreFactor[];
  keyInsights?: string[];
  recommendation?: string;
  updatedAt?: string;
  steadyPaceSecKm?: number | null;
  steadyHeartRate?: number | null;
  steadyCadence?: number | null;
  steadyStanceTime?: number | null;
  pauseBreakdown?: { pauseCount?: number; totalPauseSeconds?: number; walkSeconds?: number } | null;
}

/** Microclimate weather attached to a workout. */
export interface ActivityWeather {
  temperatureC?: number | null;
  humidityPct?: number | null;
  apparentTempC?: number | null;
  condition?: string | null;
  code?: number | null;
  windSpeedMps?: number | null;
  fetchedAt?: string | null;
}

/** GET /api/activities/:id */
export interface ActivityDetailResponse {
  activity: Activity;
  splits: ActivitySplit[];
  intervals: ActivityInterval[];
  records: ActivityRecord[];
  coachSummary: CoachSummary | null;
  heartRateThresholds?: { lt1Hr: number | null; lt2Hr: number | null } | null;
  weather?: ActivityWeather | null;
}

/** A calibration point in the threshold history. */
export interface CalibrationHistoryItem {
  id: number;
  effective_date: string;
  source_activity_id?: string | null;
  activity_name?: string | null;
  lt1_hr?: number | null;
  lt1_pace_sec_km?: number | null;
  lt2_hr?: number | null;
  lt2_pace_sec_km?: number | null;
  baseline_economy_ef?: number | null;
  confidence?: number | null;
  is_estimated?: boolean | null;
  notes?: string | null;
  distance_meters?: number | null;
  duration_seconds?: number | null;
}

/** GET /api/thresholds */
export interface ThresholdsResponse {
  currentThresholds?: {
    lt1Hr: number | null;
    lt2Hr: number | null;
    lt1PaceSecKm?: number | null;
    lt2PaceSecKm?: number | null;
    confidence?: number | null;
    source?: string | null;
    baselineEconomyEf?: number | null;
  } | null;
  zones?: Record<string, [number, number]> | null;
  predictions: Array<{
    distanceName: string;
    predictedTimeSeconds: number;
    predictedPaceSecKm?: number;
    timeFormatted?: string;
    paceFormatted?: string;
  }>;
  history: CalibrationHistoryItem[];
  economyTrend: Array<{ date: string; efficiencyFactor: number | null }>;
  scatterData: Array<{ paceSecKm: number; heartRate: number }>;
  latest?: { lt1?: CalibrationHistoryItem | null; lt2?: CalibrationHistoryItem | null } | null;
}

/** GET /api/activities/volume (single-period summary) */
export interface VolumeData {
  periodLabel?: string;
  totalDistanceKm: number;
  totalDurationHours: number;
  activityCount: number;
  avgEf?: number | null;
  zones: Record<'z1' | 'z2' | 'z3' | 'z4' | 'z5', { hours: number; pct: number }>;
}

/** An aggregated volume row. */
export interface VolumeEntry {
  period: string;
  periodLabel?: string;
  totalDistanceKm: number;
  totalDurationHours: number;
  runCount: number;
  avgPaceSecKm: number | null;
  avgHeartRate: number | null;
  zone2Pct?: number;
  totalElevationM?: number;
  trainingLoad?: number;
}

/** GET /api/activities/best-efforts */
export interface BestEffortRecord {
  targetId: string;
  label: string;
  distanceMeters: number;
  timeSeconds: number;
  paceSecKm: number;
  activityId: string;
  activityName: string;
  activityDate: string;
}

export interface BestEffortsResponse {
  allTime: BestEffortRecord[];
  currentYear: BestEffortRecord[];
  targets?: Array<{ id: string; label: string; distanceMeters: number }>;
}

/** GET /api/database/status */
export interface DatabaseSnapshot {
  filename: string;
  createdAt: string;
  sizeMb: string | number;
  sizeBytes?: number;
}

export interface DatabaseStatus {
  sizeMb: string | number;
  activityCount: number;
  snapshots: DatabaseSnapshot[];
  recentBackups?: DatabaseSnapshot[];
  settings?: {
    autoBackupEnabled: boolean;
    backupDirectory: string;
    backupIntervalDays: number;
    lastBackupAt: string | null;
  };
}

/** A single entry in an ingestion response. */
export interface IngestResultItem {
  status: 'imported' | 'skipped_duplicate' | 'skipped_non_running' | 'error';
  filename?: string;
  activityId?: string;
  error?: string;
  name?: string;
}

/** A structured log line returned by /api/dev/diagnostics. */
export interface ServerLogEntry {
  id: string;
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  category: string;
  message: string;
  durationMs?: number;
  statusCode?: number;
  error?: { name?: string; message: string; stack?: string; code?: string };
}

/** Dev-only diagnostics payload (development builds only). */
export interface ServerDiagnostics {
  status: string;
  timestamp: string;
  system: {
    nodeVersion: string;
    platform: string;
    uptimeSeconds: number;
    memoryMb: { heapUsed: number; heapTotal: number; rss: number };
  };
  db: {
    path: string;
    sizeMb: number;
    activityCount: number;
    intervalCount: number;
    splitCount: number;
    recordCount: number;
  };
  athlete: {
    configured: boolean;
    dob: string | null;
    restingHr: number | null;
    maxHr: number | null;
    lt1Hr: number | null;
    lt2Hr: number | null;
    baselineEconomyEf: number | null;
  };
  logs: ServerLogEntry[];
}

/** A partial activity patch, e.g. from the inline title editor. */
export type ActivityUpdate = Partial<Activity> & Pick<Activity, 'id'>;

/** Error envelope returned by every API failure path. */
export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
  timestamp?: string;
}

