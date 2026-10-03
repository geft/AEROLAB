import type { CoachMessages } from './coaching.js';
import type { SessionVerdict } from './session-verdict.js';
import type { Activity } from './activity.js';

/** How one coach insight should be read. */
export type ActivityCoachInsightTone = 'positive' | 'neutral' | 'caution' | 'negative';

/** Walk-split classification emitted by the steady-state extractor. */
export interface PauseBreakdown {
  stopCount: number;
  stopDurationSeconds: number;
  walkCount: number;
  walkDurationSeconds: number;
  walkDistanceMeters: number;
  steadyRunningDurationSeconds: number;
  steadyRunningDistanceMeters: number;
  steadyPaceSecKm: number | null;
  steadyHeartRate: number | null;
  steadyCadence: number | null;
  steadyStanceTimeMs: number | null;
  steadyVertOscMm: number | null;
}

/**
 * The algorithmic coach debrief attached to an activity. Structural superset of
 * the physiology `CoachSummary`, so services can return either without casting.
 */
export interface ActivityCoachSummary {
  messages?: CoachMessages;
  verdict?: SessionVerdict;
  headline: string;
  effectivenessScore: number;
  rating5?: number;
  stars?: number;
  scoreBreakdown?: unknown[];
  keyInsights?: string[];
  insightTones?: ActivityCoachInsightTone[];
  recommendation?: string;
  focusAdvice?: string | null;
  rubricCoveragePct?: number | null;
  rubricFamily?: string | null;
  walkAudit?: unknown;
  context?: unknown;
  updatedAt?: string;
  steadyPaceSecKm?: number | null;
  steadyHeartRate?: number | null;
  steadyCadence?: number | null;
  steadyStanceTime?: number | null;
  pauseBreakdown?: PauseBreakdown | null;
}

/** A row from `activity_splits`. */
export interface ActivitySplitRow {
  id?: number;
  activity_id?: string;
  split_index?: number;
  [key: string]: unknown;
}

/** A row from `activity_intervals`. */
export interface ActivityIntervalRow {
  id?: number;
  activity_id?: string;
  interval_index?: number;
  [key: string]: unknown;
}

/** A second-by-second row from `activity_records`. */
export interface ActivityRecordRow {
  id?: number;
  activity_id?: string;
  elapsed_seconds?: number | null;
  distance_m?: number | null;
  speed_mps?: number | null;
  heart_rate?: number | null;
  [key: string]: unknown;
}

/** GET /api/activities - list of runs. */
export interface ActivityListResponse {
  activities: Activity[];
}

/** GET /api/activities/:id */
export interface ActivityDetailResponse {
  activity: Activity;
  splits: ActivitySplitRow[];
  intervals: ActivityIntervalRow[];
  records: ActivityRecordRow[];
  coachSummary: ActivityCoachSummary | null;
  heartRateThresholds: { lt1Hr: number | null; lt2Hr: number | null };
  pauseBreakdown: PauseBreakdown;
  fitMetadata?: Record<string, unknown> | null;
}

/** GET /api/activities/:id/coach-summary */
export interface CoachSummaryResponse {
  coachSummary: {
    messages?: CoachMessages;
    headline: string | null;
    verdict: SessionVerdict | null;
    effectivenessScore: number;
    rating5: number;
    stars: number;
    scoreBreakdown: unknown[];
    keyInsights: string[];
    insightTones: unknown[];
    recommendation: string | null;
    focusAdvice: unknown;
    rubricCoveragePct: unknown;
    rubricFamily: unknown;
    walkAudit: unknown;
    context: unknown;
    updatedAt: string | null;
    steadyPaceSecKm: number | null;
    steadyHeartRate: number | null;
    steadyCadence: number | null;
    steadyStanceTime: number | null;
    pauseBreakdown: unknown;
  };
}

/** PATCH /api/activities/:id */
export interface ActivityPatchResponse {
  activity: Activity;
  coachSummary: ActivityCoachSummary | null;
}

/** POST /api/activities/:id/weather/refresh */
export interface WeatherRefreshResponse {
  activity: Activity;
  weather: unknown;
  coachSummary: ActivityCoachSummary | null;
}
