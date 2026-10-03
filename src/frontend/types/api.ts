import type { CoachMessages, CoachCategoryId, CoachFindingId } from '../../shared/coaching.js';
import type { SessionVerdict } from '../../shared/session-verdict.js';
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

/**
 * Shapes that the backend and the frontend both name — the activity row and the
 * session verdict — live in `src/shared/` so the two sides cannot drift. They are
 * re-exported here so components keep importing from one client-side module.
 */
export type { Activity } from '../../shared/activity.js';
import type { Activity } from '../../shared/activity.js';



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
  power_w?: number | null;
  vertical_ratio?: number | null;
  stance_time_balance?: number | null;
  step_length_m?: number | null;
  fractional_cadence?: number | null;
  respiration_rate?: number | null;
  core_temperature_c?: number | null;
  fit_fields_json?: string | null;
}

/** One itemised line in the execution score. */
export interface ScoreFactor {
  categoryId?: CoachCategoryId;
  findingId?: CoachFindingId;
  category: string;
  label: string;
  description?: string;
  points: number;
  /** Weight of this factor in the run-type rubric (100 points in total). */
  maxPoints?: number;
  /** True for the factor that lost the most points (the biggest lever). */
  isFocus?: boolean;
}

/** Personal-baseline comparison against the athlete's own recent history. */
export interface CoachContext {
  windowDays: number;
  comparableRuns: number;
  lastSimilarRun?: {
    id: string;
    startTime: string;
    distanceKm: number;
    paceSecKm: number;
    heartRate: number;
    aboveCeilingPct?: number | null;
  } | null;
  currentHeartRate?: number | null;
  currentAboveCeilingPct?: number | null;
  baselineEf: number | null;
  efDeltaPct: number | null;
  baselineEfSamples: number;
  baselineHrAtPace: number | null;
  hrAtPaceDeltaBpm: number | null;
  hrAtPaceSamples: number;
  currentPaceSecKm: number | null;
  decouplingRank: number | null;
  decouplingSamples: number;
  decouplingBestPct: number | null;
  longestDistanceKm: number | null;
  isLongestRun: boolean;
  acute7DayLoad: number | null;
  chronicWeeklyLoad: number | null;
  acwr: number | null;
}

/** Walk-break classification: why the athlete walked, not just how much. */
export interface WalkAudit {
  blockCount: number;
  walkSec: number;
  movingSec: number;
  deliberateWalkSec: number;
  preventiveWalkSec: number;
  correctiveWalkSec: number;
  hardWalkSec: number;
  capacityWalkSec: number;
  plannedPattern: boolean;
  avgPreventiveEntryHr: number | null;
  avgCorrectiveEntryHr: number | null;
  avgCapacityEntryHr: number | null;
  maxEntryHr: number | null;
  intrusiveWalkSec: number;
}

/**
 * How one coach insight should be read: a strength, context, something to watch
 * or something to fix. Decided by the coach engine alongside the sentence.
 */
export type CoachInsightTone = 'positive' | 'neutral' | 'caution' | 'negative';

/** The algorithmic coach debrief attached to an activity. */
export interface CoachSummary {
  messages?: CoachMessages;
  verdict?: SessionVerdict;
  headline: string;
  effectivenessScore: number;
  rating5?: number;
  stars?: number;
  scoreBreakdown?: ScoreFactor[];
  keyInsights?: string[];
  /**
   * One tone per entry of `keyInsights`, index-for-index. Missing on rows
   * written before tones existed, in which case the list renders uncoloured.
   */
  insightTones?: CoachInsightTone[];
  recommendation?: string;
  /** The single factor that lost the most points, phrased as the next action. */
  focusAdvice?: string | null;
  /** How much of the 100-point rubric was measurable (0-100). */
  rubricCoveragePct?: number | null;
  /** Which weighted rubric was applied: aerobic, quality or race. */
  rubricFamily?: string | null;
  /** Walk-break classification (why the athlete walked). */
  walkAudit?: WalkAudit | null;
  context?: CoachContext | null;
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
  fitMetadata?: Record<string, unknown> | null;
}

/** A calibration point in the threshold history. */
export interface CalibrationHistoryItem {
  id: number;
  effective_date: string;
  source_activity_id?: string | null;
  activity_name?: string | null;
  activity_run_type?: string | null;
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
    lt1Range?: [number, number] | null;
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
    timeSeconds: number;
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
  /** Missing only in older offline snapshots. */
  source?: 'measured' | 'estimated';
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
  dbPath: string;
  startupDbPath?: string;
  sizeMb: string | number;
  activityCount: number;
  snapshots: DatabaseSnapshot[];
  recentBackups?: DatabaseSnapshot[];
  settings?: {
    backupDirectory: string;
  };
}

export interface MaintenanceStatus {
  status: 'idle' | 'running' | 'complete' | 'failed' | 'interrupted';
}

/** A single entry in an ingestion response. */
export interface IngestResultItem {
  status: 'imported' | 'skipped_duplicate' | 'skipped_non_running' | 'error';
  filename?: string;
  activityId?: string;
  error?: string;
  name?: string;
  reason?: string;
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

/** A profile patch body. The route validates and ignores unknown keys. */
export type ProfileUpdateInput = Record<string, unknown>;

/** A detected observed peak heart rate from a real hard effort. */
export interface ObservedPeakHeartRate {
  peakHr: number;
  activityId: string;
  activityName: string;
  activityDate: string;
  runType: string;
}

/** The athlete_profile row as returned by the profile endpoints. */
export interface AthleteProfile {
  id?: string;
  name?: string | null;
  gender?: string | null;
  age?: number | null;
  dob?: string | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  resting_hr?: number | null;
  max_hr?: number | null;
  is_max_hr_estimated?: number | boolean | null;
  is_configured?: number | boolean | null;
  [key: string]: unknown;
}

/** GET /api/profile */
export interface ProfileResponse {
  profile: AthleteProfile | null;
  currentThresholds?: ThresholdsResponse['currentThresholds'];
  zones?: ThresholdsResponse['zones'];
  observedPeakHr?: ObservedPeakHeartRate | null;
  tanakaMaxHr?: number | null;
  effectiveMaxHr?: number | null;
  maxHrSource?: string;
  isConfigured?: boolean;
}

/** PATCH /api/profile */
export interface ProfilePatchResponse {
  profile: AthleteProfile;
  syncedActivitiesCount?: number;
  syncScheduled?: boolean;
}

/** One day of the training-load timeline. */
export interface DayLoadPoint {
  date: string;
  dailyLoad: number;
  acuteLoad: number;
  chronicLoad: number;
  optimalMin: number;
  optimalMax: number;
  acwr: number;
}

/** The computed training status shown by the training-load card. */
export interface TrainingStatusData {
  currentAcuteLoad: number;
  currentChronicLoad: number;
  acwr: number;
  status: 'optimal' | 'recovery' | 'overreaching' | 'very_high' | 'maintaining' | 'establishing';
  statusLabel: string;
  statusDescription: string;
  optimalRange: { min: number; max: number };
  last7DaysLoad: number;
  timeline: DayLoadPoint[];
}

/** GET /api/activities/training-load */
export interface TrainingLoadResponse {
  trainingStatus: TrainingStatusData;
}

/** One monthly or yearly bucket of GET /api/activities/progress-history. */
export interface ProgressPeriodSummary {
  period: string;
  label: string;
  runCount: number;
  totalDistanceKm: number;
  totalDurationHours: number;
  totalElevationM?: number;
  avgEfficiencyFactor: number | null;
  avgPaceSecKm: number | null;
  avgHeartRate: number | null;
  zone2Hours?: number;
  zone2Pct?: number;
  activeMonths?: number;
  calibrations?: CalibrationHistoryItem[];
}

/** GET /api/activities/progress-history */
export interface ProgressHistoryResponse {
  months: ProgressPeriodSummary[];
  years: ProgressPeriodSummary[];
}

/** PATCH /api/activities/:id */
export interface ActivityPatchResponse {
  activity: Activity;
  coachSummary: CoachSummary | null;
}

/** A partial activity patch body for PATCH /api/activities/:id. */
export interface ActivityPatchInput {
  run_type?: string;
  name?: string;
  tags?: string[];
}

/** One item in a batch ingestion response. */
export interface UploadResult {
  status: 'imported' | 'skipped' | 'skipped_duplicate' | 'skipped_non_run' | 'error' | (string & {});
  activityId?: string;
  reason?: string;
  message?: string;
  error?: string;
  name?: string;
}

/** POST /api/ingest/upload */
export interface UploadResponse {
  result: UploadResult;
}

/** POST /api/database/restore */
export interface RestoreDatabaseResponse {
  status: 'ok';
  activityCount?: number;
  safetyBackupPath?: string;
}

/** POST /api/database/restore-snapshot */
export interface RestoreSnapshotResponse {
  success: boolean;
  activityCount?: number;
}

/** POST /api/database/backup */
export interface DatabaseBackupInfo {
  filePath?: string;
  filename: string;
  sizeBytes: number;
  createdAt?: string;
}

export interface BackupResponse {
  status: 'ok';
  backup: DatabaseBackupInfo;
}

/** POST /api/database/settings */
export interface BackupSettingsResponse {
  status: 'ok';
  settings: DatabaseStatus['settings'];
}

/** POST /api/database/select-folder */
export interface SelectFolderResponse {
  folder: string | null;
  cancelled?: boolean;
}
