import { assertDatabaseWritable } from '../application/database-operations.js';
import Database from 'better-sqlite3';
import { profileFromRow } from '../db/rows.js';
import { ageFromDob } from '../../shared/heart-rate.js';
import type { ProfileResponse, ProfilePatchResponse } from '../../shared/profile.js';
import { getAthleteHeartRateProfile, getObservedPeakHeartRate } from '../physiology/athlete-profile.js';
import { getDefaultZones } from '../physiology/zones.js';
import { recomputeProfileDerivedData } from '../physiology/profile-recompute.js';
import { queueProfileRecompute } from '../jobs/maintenance.js';
import { getCurrentThresholds } from '../physiology/threshold-tracker.js';

// Re-exported so existing importers of routes/profile keep working after the
// physiology call moved behind this service.
export { getObservedPeakHeartRate };

/** GET /api/profile - athlete profile and calculated HRR zones reflecting current LT1/LT2 */
export function getProfileService(db: Database.Database): ProfileResponse | null {
  const row = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary');
  if (!row) return null;
  const profile = profileFromRow(row);

  const hasRequiredBaselines = Boolean(profile.dob && profile.resting_hr);
  const isConfigured = profile.is_configured === 1 && hasRequiredBaselines;

  const currentThresholds = getCurrentThresholds(db);
  const dynamicAge = ageFromDob(profile.dob, Number(profile.age) || 0);
  const tanakaMaxHr = Math.round(208 - 0.7 * dynamicAge);
  const observedPeak = getObservedPeakHeartRate(db, dynamicAge);

  const hrProfile = getAthleteHeartRateProfile(db);
  const effectiveMaxHr = hrProfile.maxHr;
  const maxHrSource = observedPeak ? 'observed_run' : 'tanaka_formula';

  const zones = getDefaultZones(
    effectiveMaxHr,
    currentThresholds.lt1Hr,
    currentThresholds.lt2Hr,
    hrProfile.restingHr
  );

  return {
    profile: {
      ...profile,
      age: dynamicAge || null,
      is_configured: isConfigured ? 1 : 0,
      max_hr: hrProfile.hasBaseline ? effectiveMaxHr : null,
      is_max_hr_estimated: 1,
      preferences: typeof profile.preferences_json === 'string' ? JSON.parse(profile.preferences_json) : null
    },
    currentThresholds: hrProfile.hasBaseline ? currentThresholds : null,
    zones: hrProfile.hasBaseline ? zones : null,
    observedPeakHr: observedPeak,
    tanakaMaxHr: dynamicAge ? tanakaMaxHr : null,
    effectiveMaxHr: hrProfile.hasBaseline ? effectiveMaxHr : null,
    maxHrSource,
    isConfigured
  };
}

export interface UpdateProfileInput {
  gender?: string; age?: number; dob?: string;
  resting_hr?: number; max_hr?: number;
  is_max_hr_estimated?: boolean | 0 | 1; pb_5k?: string;
  is_configured?: boolean | 0 | 1;
  opt_out_max_hr?: boolean; preferences?: unknown;
}

const textFields = new Set(['gender', 'dob', 'pb_5k']);
const numberFields = new Set(['age', 'resting_hr', 'max_hr']);
const flagFields = new Set(['is_max_hr_estimated', 'is_configured', 'opt_out_max_hr']);

export function parseProfileUpdate(value: unknown): UpdateProfileInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (textFields.has(key)) {
      if (field !== null && typeof field !== 'string') return null;
    } else if (numberFields.has(key)) {
      if (key === 'resting_hr' && field === null) return null;
      if (field !== null && (typeof field !== 'number' || !Number.isFinite(field))) return null;
    } else if (flagFields.has(key)) {
      if (field !== true && field !== false && field !== 0 && field !== 1) return null;
    } else if (key === 'preferences') {
      if (field !== null && (typeof field !== 'object' || Array.isArray(field))) return null;
    } else {
      return null;
    }
    result[key] = field;
  }
  return result as UpdateProfileInput;
}

export type UpdateProfileResult =
  | { ok: true; response: ProfilePatchResponse }
  | { ok: false; status: 400; code?: string; error: string };

/** PATCH /api/profile - update athlete profile */
export function updateProfileService(db: Database.Database, rawUpdates: UpdateProfileInput): UpdateProfileResult {
  assertDatabaseWritable();
  const updates: Record<string, unknown> = { ...rawUpdates };

  const allowedFields = [
    'gender', 'age', 'dob', 'resting_hr', 'max_hr',
    'is_max_hr_estimated', 'pb_5k', 'is_configured'
  ];

  const existingRow = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary');
  const existing = existingRow ? profileFromRow(existingRow) : null;

  // Dynamically derive age from DOB if DOB is provided
  let ageVal: number;
  if (updates.dob) {
    ageVal = ageFromDob(String(updates.dob), Number(updates.age) || Number(existing?.age) || 0);
    updates.age = ageVal;
  } else {
    ageVal = Number(updates.age) || ageFromDob(typeof existing?.dob === 'string' ? existing.dob : null, Number(existing?.age) || 0);
  }

  const tanakaMax = ageVal > 0 ? Math.round(208 - 0.7 * ageVal) : null;
  const observedPeak = getObservedPeakHeartRate(db, ageVal);

  // Safeguard resting_hr from accidental reset or corruption
  if (updates.resting_hr !== undefined) {
    if (updates.resting_hr === null || updates.resting_hr === '') {
      return {
        ok: false, status: 400, code: 'ERR_INVALID_RESTING_HR',
        error: 'Resting heart rate cannot be null or empty'
      };
    }
    const parsedRhr = Number(updates.resting_hr);
    if (isNaN(parsedRhr) || parsedRhr < 30 || parsedRhr > 120) {
      return {
        ok: false, status: 400, code: 'ERR_INVALID_RESTING_HR',
        error: 'Resting heart rate must be a valid number between 30 and 120 bpm'
      };
    }
    updates.resting_hr = Math.round(parsedRhr);
  }

  // Legacy clients may still send maximum-HR fields. Always derive the value.
  const baselineChanged = ['dob', 'age', 'max_hr', 'resting_hr', 'is_max_hr_estimated', 'opt_out_max_hr', 'gender'].some(key => key in updates);
  if (baselineChanged) {
    updates.max_hr = observedPeak?.peakHr ?? tanakaMax;
    updates.is_max_hr_estimated = 1;
  }

  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  for (const [key, val] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      sets.push(`${key} = ?`);
      values.push(val === null ? null : typeof val === 'boolean' ? Number(val) : val as string | number);
    } else if (key === 'preferences') {
      sets.push(`preferences_json = ?`);
      values.push(JSON.stringify(val));
    }
  }

  let syncedActivitiesCount = 0;
  let syncScheduled = false;
  if (sets.length > 0) {
    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push('primary');
    db.prepare(`UPDATE athlete_profile SET ${sets.join(', ')} WHERE id = ?`).run(...values);

    if (baselineChanged) {
      // These columns cache inferred thresholds, not manually entered baselines.
      db.prepare("UPDATE athlete_profile SET lt1_hr = NULL, lt2_hr = NULL, lt1_min_hr = NULL, lt1_max_hr = NULL, z3_start_hr = NULL, z4_start_hr = NULL WHERE id = 'primary'").run();
      const thresholds = getCurrentThresholds(db);
      db.prepare("UPDATE athlete_profile SET lt1_hr = ?, lt2_hr = ?, lt1_min_hr = ?, lt1_max_hr = ?, z3_start_hr = ?, z4_start_hr = ? WHERE id = 'primary'")
        .run(thresholds.lt1Hr, thresholds.lt2Hr, thresholds.lt1Hr - 1, thresholds.lt1Hr + 1, thresholds.lt1Hr + 1, thresholds.lt2Hr);
    }

    if (process.env.NODE_ENV === 'test') {
      syncedActivitiesCount = recomputeProfileDerivedData(db, baselineChanged);
    } else {
      queueProfileRecompute(db.name, baselineChanged);
      syncScheduled = true;
    }
  }

  const updatedRow = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary');
  if (!updatedRow) throw new Error('Profile not found after update');
  const updated = profileFromRow(updatedRow);
  const updatedHr = getAthleteHeartRateProfile(db);
  return {
    ok: true,
    response: {
      profile: {
        ...updated,
        max_hr: updatedHr.hasBaseline ? updatedHr.maxHr : null,
        is_max_hr_estimated: 1,
        preferences: typeof updated.preferences_json === 'string' ? JSON.parse(updated.preferences_json) : null
      },
      syncedActivitiesCount,
      syncScheduled
    }
  };
}
