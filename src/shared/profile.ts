import type { CurrentThresholds, HeartRateZones } from './thresholds.js';

/** A detected observed peak heart rate from a real hard effort. */
export interface ObservedPeakHeartRate {
  peakHr: number;
  activityId: string;
  activityName: string;
  activityDate: string;
  runType: string;
}

/** A row of the athlete_profile table (loose: the schema evolves additively). */
export interface AthleteProfileRow {
  id: string;
  gender?: string | null;
  age?: number | null;
  dob?: string | null;
  resting_hr?: number | null;
  max_hr?: number | null;
  is_max_hr_estimated?: number | null;
  is_configured?: number | null;
  [key: string]: unknown;
}

/** The profile payload returned by GET /api/profile. */
export interface ProfilePayload extends AthleteProfileRow {
  age: number | null;
  is_configured: number;
  max_hr: number | null;
  preferences: unknown;
}

/** The profile payload returned by PATCH /api/profile. */
export interface ProfilePatchPayload extends AthleteProfileRow {
  preferences: unknown;
}

/** GET /api/profile */
export interface ProfileResponse {
  profile: ProfilePayload;
  currentThresholds: CurrentThresholds | null;
  zones: HeartRateZones | null;
  observedPeakHr: ObservedPeakHeartRate | null;
  tanakaMaxHr: number | null;
  effectiveMaxHr: number | null;
  maxHrSource: 'observed_run' | 'tanaka_formula';
  isConfigured: boolean;
}

/** PATCH /api/profile */
export interface ProfilePatchResponse {
  profile: ProfilePatchPayload;
  syncedActivitiesCount: number;
  syncScheduled: boolean;
}
