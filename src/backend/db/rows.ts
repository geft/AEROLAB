import type { Activity } from '../../shared/activity.js';
import type { ActivityIntervalRow, ActivityRecordRow, ActivitySplitRow } from '../../shared/activity-detail.js';
import type { AthleteProfileRow } from '../../shared/profile.js';

export function objectRow(value: unknown, table: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${table} row`);
  }
  return value as Record<string, unknown>;
}

export interface VolumeActivityDbRow {
  id: string; start_time: string; distance_meters: number | null; duration_seconds: number | null;
  elevation_gain_m: number | null; efficiency_factor: number | null; run_type: string | null;
  training_load: number | null; z1_seconds: number | null; z2_seconds: number | null;
  z3_seconds: number | null; z4_seconds: number | null; z5_seconds: number | null;
}

export interface ProgressActivityDbRow {
  id: string; start_time: string; name: string | null; run_type: string | null;
  distance_meters: number | null; duration_seconds: number | null; avg_pace_sec_km: number | null;
  avg_heart_rate: number | null; efficiency_factor: number | null; elevation_gain_m: number | null;
  aerobic_decoupling_pct: number | null;
}

export interface HeartRateRecordDbRow { elapsed_seconds: number; heart_rate: number | null }
export interface CoachSummaryDbRow {
  headline: string; effectiveness_score: number; key_insights_json: string; insight_tones_json: string | null;
  recommendation: string; score_breakdown_json: string | null; analysis_json: string | null; updated_at: string | null;
  steady_pace_sec_km: number | null; steady_heart_rate: number | null; steady_cadence: number | null;
  steady_stance_time: number | null; pause_breakdown_json: string | null;
}

function nullableString(row: Record<string, unknown>, key: string, table: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`Invalid ${table}.${key}`);
  return value;
}

export function coachSummaryFromRow(value: unknown): CoachSummaryDbRow {
  const row = objectRow(value, 'activity_coach_summaries');
  const headline = requiredString(row, 'headline', 'activity_coach_summaries');
  const recommendation = requiredString(row, 'recommendation', 'activity_coach_summaries');
  const key_insights_json = requiredString(row, 'key_insights_json', 'activity_coach_summaries');
  const effectiveness_score = nullableNumber(row, 'effectiveness_score', 'activity_coach_summaries');
  if (effectiveness_score === null) throw new Error('Invalid activity_coach_summaries.effectiveness_score');
  return {
    headline, recommendation, key_insights_json, effectiveness_score,
    insight_tones_json: nullableString(row, 'insight_tones_json', 'activity_coach_summaries'),
    score_breakdown_json: nullableString(row, 'score_breakdown_json', 'activity_coach_summaries'),
    analysis_json: nullableString(row, 'analysis_json', 'activity_coach_summaries'),
    updated_at: nullableString(row, 'updated_at', 'activity_coach_summaries'),
    steady_pace_sec_km: nullableNumber(row, 'steady_pace_sec_km', 'activity_coach_summaries'),
    steady_heart_rate: nullableNumber(row, 'steady_heart_rate', 'activity_coach_summaries'),
    steady_cadence: nullableNumber(row, 'steady_cadence', 'activity_coach_summaries'),
    steady_stance_time: nullableNumber(row, 'steady_stance_time', 'activity_coach_summaries'),
    pause_breakdown_json: nullableString(row, 'pause_breakdown_json', 'activity_coach_summaries')
  };
}

export function volumeActivityFromRow(value: unknown): VolumeActivityDbRow {
  const row = objectRow(value, 'activities');
  const id = requiredString(row, 'id', 'activities');
  const start_time = requiredString(row, 'start_time', 'activities');
  const runType = row.run_type;
  if (runType != null && typeof runType !== 'string') throw new Error('Invalid activities.run_type');
  return {
    id, start_time, run_type: runType as string | null ?? null,
    distance_meters: nullableNumber(row, 'distance_meters', 'activities'),
    duration_seconds: nullableNumber(row, 'duration_seconds', 'activities'),
    elevation_gain_m: nullableNumber(row, 'elevation_gain_m', 'activities'),
    efficiency_factor: nullableNumber(row, 'efficiency_factor', 'activities'),
    training_load: nullableNumber(row, 'training_load', 'activities'),
    z1_seconds: nullableNumber(row, 'z1_seconds', 'activities'), z2_seconds: nullableNumber(row, 'z2_seconds', 'activities'),
    z3_seconds: nullableNumber(row, 'z3_seconds', 'activities'), z4_seconds: nullableNumber(row, 'z4_seconds', 'activities'),
    z5_seconds: nullableNumber(row, 'z5_seconds', 'activities')
  };
}

export function progressActivityFromRow(value: unknown): ProgressActivityDbRow {
  const row = objectRow(value, 'activities');
  const id = requiredString(row, 'id', 'activities');
  const start_time = requiredString(row, 'start_time', 'activities');
  const stringValue = (key: string): string | null => {
    const field = row[key];
    if (field != null && typeof field !== 'string') throw new Error(`Invalid activities.${key}`);
    return field as string | null ?? null;
  };
  return {
    id, start_time, name: stringValue('name'), run_type: stringValue('run_type'),
    distance_meters: nullableNumber(row, 'distance_meters', 'activities'),
    duration_seconds: nullableNumber(row, 'duration_seconds', 'activities'),
    avg_pace_sec_km: nullableNumber(row, 'avg_pace_sec_km', 'activities'),
    avg_heart_rate: nullableNumber(row, 'avg_heart_rate', 'activities'),
    efficiency_factor: nullableNumber(row, 'efficiency_factor', 'activities'),
    elevation_gain_m: nullableNumber(row, 'elevation_gain_m', 'activities'),
    aerobic_decoupling_pct: nullableNumber(row, 'aerobic_decoupling_pct', 'activities')
  };
}

export function heartRateRecordFromRow(value: unknown): HeartRateRecordDbRow {
  const row = objectRow(value, 'activity_records');
  const elapsed_seconds = nullableNumber(row, 'elapsed_seconds', 'activity_records');
  if (elapsed_seconds === null) throw new Error('Invalid activity_records.elapsed_seconds');
  return { elapsed_seconds, heart_rate: nullableNumber(row, 'heart_rate', 'activity_records') };
}

function telemetryRow<T>(value: unknown, table: string, numberFields: string[]): T {
  const row = objectRow(value, table);
  for (const key of numberFields) nullableNumber(row, key, table);
  if (row.activity_id != null && typeof row.activity_id !== 'string') throw new Error(`Invalid ${table}.activity_id`);
  return row as T;
}

export type ValidatedActivityRecordRow = ActivityRecordRow & { elapsed_seconds: number; distance_m: number | null; speed_mps: number | null };

export function activityRecordFromRow(value: unknown): ValidatedActivityRecordRow {
  const row = telemetryRow<ActivityRecordRow>(value, 'activity_records', [
    'id', 'elapsed_seconds', 'heart_rate', 'cadence', 'speed_mps', 'distance_m', 'altitude_m', 'lat', 'lon', 'temp', 'vert_osc', 'stance_time'
  ]);
  const elapsed = nullableNumber(row, 'elapsed_seconds', 'activity_records');
  if (elapsed === null) throw new Error('Invalid activity_records.elapsed_seconds');
  return { ...row, elapsed_seconds: elapsed, distance_m: nullableNumber(row, 'distance_m', 'activity_records'), speed_mps: nullableNumber(row, 'speed_mps', 'activity_records') };
}

export function activitySplitFromRow(value: unknown): ActivitySplitRow {
  return telemetryRow<ActivitySplitRow>(value, 'activity_splits', [
    'id', 'split_index', 'distance_meters', 'duration_seconds', 'avg_pace_sec_km', 'avg_heart_rate',
    'split_efficiency_factor', 'elevation_change_m', 'avg_cadence', 'avg_stance_time', 'avg_vert_osc', 'avg_vert_ratio'
  ]);
}

export function activityIntervalFromRow(value: unknown): ActivityIntervalRow {
  const row = telemetryRow<ActivityIntervalRow>(value, 'activity_intervals', [
    'id', 'interval_index', 'start_seconds', 'duration_seconds', 'distance_meters', 'avg_speed_mps', 'avg_pace_sec_km',
    'avg_heart_rate', 'max_heart_rate', 'avg_cadence', 'peak_cadence', 'peak_speed_mps', 'peak_pace_sec_km',
    'min_stance_time', 'hr_drop', 'avg_vert_osc', 'avg_stance_time', 'avg_step_length', 'avg_stride_length', 'avg_vert_ratio'
  ]);
  if (row.type != null && typeof row.type !== 'string') throw new Error('Invalid activity_intervals.type');
  return row;
}

function requiredString(row: Record<string, unknown>, key: string, table: string): string {
  if (typeof row[key] !== 'string' || row[key] === '') throw new Error(`Invalid ${table}.${key}`);
  return row[key];
}

function nullableNumber(row: Record<string, unknown>, key: string, table: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${table}.${key}`);
  return value;
}

export function activityFromRow(value: unknown): Activity {
  const row = objectRow(value, 'activities');
  const id = requiredString(row, 'id', 'activities');
  const start_time = requiredString(row, 'start_time', 'activities');
  const distance_meters = nullableNumber(row, 'distance_meters', 'activities');
  const duration_seconds = nullableNumber(row, 'duration_seconds', 'activities');
  if (distance_meters === null || duration_seconds === null) throw new Error('Invalid activities distance or duration');
  const name = row.name;
  const run_type = row.run_type;
  if (name != null && typeof name !== 'string') throw new Error('Invalid activities.name');
  if (run_type != null && typeof run_type !== 'string') throw new Error('Invalid activities.run_type');
  return {
    ...row,
    id, start_time, distance_meters, duration_seconds,
    name: name ?? null,
    run_type: run_type ?? null,
    avg_pace_sec_km: nullableNumber(row, 'avg_pace_sec_km', 'activities'),
    avg_heart_rate: nullableNumber(row, 'avg_heart_rate', 'activities'),
    avg_cadence: nullableNumber(row, 'avg_cadence', 'activities'),
  } as Activity;
}

export function profileFromRow(value: unknown): AthleteProfileRow {
  const row = objectRow(value, 'athlete_profile');
  const id = requiredString(row, 'id', 'athlete_profile');
  for (const key of ['age', 'resting_hr', 'max_hr', 'is_configured', 'is_max_hr_estimated']) {
    nullableNumber(row, key, 'athlete_profile');
  }
  for (const key of ['name', 'gender', 'dob', 'schedule_json', 'preferences_json']) {
    if (row[key] != null && typeof row[key] !== 'string') throw new Error(`Invalid athlete_profile.${key}`);
  }
  return { ...row, id };
}
