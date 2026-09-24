import type { Activity } from '../../shared/activity.js';
import type { AthleteProfileRow } from '../../shared/profile.js';

function objectRow(value: unknown, table: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${table} row`);
  }
  return value as Record<string, unknown>;
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
