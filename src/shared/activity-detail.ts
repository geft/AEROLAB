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

/** Compatibility export for the canonical shared coaching DTO. */
export type { CoachSummary as ActivityCoachSummary } from './contracts/activity-detail.js';
import type { CoachSummary as ActivityCoachSummary, ActivityWeather, ActivityDetailResponse as DetailDto } from './contracts/activity-detail.js';
/** Shared wire DTOs are also the validated SQLite read shapes. */
export type { ActivitySplit as ActivitySplitRow, ActivityInterval as ActivityIntervalRow, ActivityRecord as ActivityRecordRow } from './contracts/activity-detail.js';

/** GET /api/activities - list of runs. */
export interface ActivityListResponse {
  activities: Activity[];
}

/** GET /api/activities/:id */
export interface ActivityDetailResponse extends DetailDto {
  heartRateThresholds: { lt1Hr: number | null; lt2Hr: number | null };
  pauseBreakdown: PauseBreakdown;
}

/** GET /api/activities/:id/coach-summary */
export interface CoachSummaryResponse { coachSummary: ActivityCoachSummary }

/** PATCH /api/activities/:id */
export interface ActivityPatchResponse {
  activity: Activity;
  coachSummary: ActivityCoachSummary | null;
}

/** POST /api/activities/:id/weather/refresh */
export interface WeatherRefreshResponse {
  activity: Activity;
  weather: ActivityWeather;
  coachSummary: ActivityCoachSummary | null;
}
