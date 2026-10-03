import type { CoachMessages, CoachCategoryId, CoachFindingId } from '../coaching.js';
import type { SessionVerdict } from '../session-verdict.js';
import type { Activity } from '../activity.js';
import type { PauseBreakdown } from '../activity-detail.js';
import type { AnalysisFreshness, AnalysisProvenance } from '../analysis-revision.js';
import type { ClassificationEvidence } from './classification.js';

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
  timerActive?: boolean;
  timerSegment?: number;
  timerPauseSeconds?: number;
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
  runFamily?: 'aerobic' | 'quality' | 'race';
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
  rawBlockCount?: number;
  recoveryWalkSec?: number;
  recoveryBlockCount?: number;
  artifactWalkSec?: number;
  artifactBlockCount?: number;
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
  classificationEvidence?: ClassificationEvidence;
  analysisProvenance?: AnalysisProvenance;
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
  pauseBreakdown?: Partial<PauseBreakdown> & { pauseCount?: number; totalPauseSeconds?: number; walkSeconds?: number } | null;
}

/** Microclimate weather attached to a workout. */
export interface ActivityWeather {
  pm25?: number | null;
  pm25Source?: 'nea-sg' | 'open-meteo' | null;
  weatherCode?: number | null;
  conditionText?: string | null;
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
  analysisFreshness?: AnalysisFreshness;
  pauseBreakdown?: PauseBreakdown;
  activity: Activity;
  splits: ActivitySplit[];
  intervals: ActivityInterval[];
  records: ActivityRecord[];
  coachSummary: CoachSummary | null;
  heartRateThresholds?: { lt1Hr: number | null; lt2Hr: number | null } | null;
  weather?: ActivityWeather | null;
  fitMetadata?: Record<string, unknown> | null;
}
