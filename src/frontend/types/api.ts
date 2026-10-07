import type { CoachSummary } from '../../shared/contracts/activity-detail.js';
import type { ThresholdEvidence } from '../../shared/threshold-evidence.js';
import type { AerobicAssessment } from '../../shared/aerobic-assessment.js';
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



export type { ActivitySplit, ActivityInterval, ActivityRecord, ScoreFactor, CoachContext, WalkAudit, CoachInsightTone, CoachSummary, ActivityWeather, ActivityDetailResponse } from '../../shared/contracts/activity-detail.js';

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
  threshold_evidence_temperature_c?: number | null;
  lt1_evidence_usable?: boolean;
  lt1_evidence_hr?: number;
  lt1_evidence_pace?: number | null;
  lt1_evidence_confidence?: number;
  lt1_evidence_kind?: 'continuous' | 'run_walk';
  lt1_recovery_fraction?: number;
  lt1_running_bout_seconds?: number;
  lt2_evidence_usable?: boolean;
  source_kind?: string;
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
    lt1Evidence?: ThresholdEvidence;
    lt2Evidence?: ThresholdEvidence;
    lt1Assessment?: AerobicAssessment;
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
