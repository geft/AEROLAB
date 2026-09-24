import Database from 'better-sqlite3';
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
  const profile = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;
  if (!profile) return null;

  const hasRequiredBaselines = Boolean(profile.dob && profile.resting_hr);
  const isConfigured = profile.is_configured === 1 && hasRequiredBaselines;

  const currentThresholds = getCurrentThresholds(db);
  const dynamicAge = ageFromDob(profile.dob, Number(profile.age) || 0);
  const tanakaMaxHr = Math.round(208 - 0.7 * dynamicAge);
  const observedPeak = getObservedPeakHeartRate(db, dynamicAge);

  const hrProfile = getAthleteHeartRateProfile(db);
  const effectiveMaxHr = hrProfile.maxHr;
  const maxHrSource = !profile.is_max_hr_estimated && profile.max_hr ? 'manual'
    : observedPeak ? 'observed_run' : 'tanaka_formula';

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
      max_hr: hrProfile.hasBaseline ? effectiveMaxHr : profile.max_hr,
      schedule: profile.schedule_json ? JSON.parse(profile.schedule_json) : null,
      preferences: profile.preferences_json ? JSON.parse(profile.preferences_json) : null
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
  [key: string]: unknown;
}

export type UpdateProfileResult =
  | { ok: true; response: ProfilePatchResponse }
  | { ok: false; status: 400; code?: string; error: string };

/** PATCH /api/profile - update athlete profile */
export function updateProfileService(db: Database.Database, rawUpdates: UpdateProfileInput): UpdateProfileResult {
  const updates: any = { ...rawUpdates };

  const allowedFields = [
    'name', 'gender', 'age', 'dob', 'height_cm', 'weight_kg', 'resting_hr', 'max_hr',
    'is_max_hr_estimated', 'hr_metric', 'vo2_max',
    'goal_marathon', 'upcoming_benchmark', 'pb_5k', 'pb_hm',
    'shoe_threshold', 'shoe_easy', 'shoe_retired', 'location',
    'favorite_route', 'is_configured'
  ];

  const existing = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;

  // Dynamically derive age from DOB if DOB is provided
  let ageVal: number;
  if (updates.dob) {
    ageVal = ageFromDob(updates.dob, Number(updates.age) || Number(existing?.age) || 0);
    updates.age = ageVal;
  } else {
    ageVal = Number(updates.age) || ageFromDob(existing?.dob, Number(existing?.age) || 0);
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

  // Handle Max HR Opt-Out / Estimation:
  // If opting out of manual entry, prefer observed peak from real hard runs; otherwise fall back to Tanaka formula
  if (updates.opt_out_max_hr || updates.is_max_hr_estimated) {
    if (observedPeak) {
      updates.max_hr = observedPeak.peakHr;
    } else {
      if (!tanakaMax) return { ok: false, status: 400, error: 'A valid date of birth or age is required to estimate maximum heart rate.' };
      updates.max_hr = tanakaMax;
    }
    updates.is_max_hr_estimated = 1;
  } else if (updates.max_hr !== undefined && !updates.is_max_hr_estimated) {
    const parsedMax = Number(updates.max_hr);
    if (isNaN(parsedMax) || parsedMax < 100 || parsedMax > 240) {
      return {
        ok: false, status: 400, code: 'ERR_INVALID_MAX_HR',
        error: 'Max heart rate must be a valid number between 100 and 240 bpm'
      };
    }
    updates.max_hr = Math.round(parsedMax);
    updates.is_max_hr_estimated = 0;
  }

  const sets: string[] = [];
  const values: any[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      sets.push(`${key} = ?`);
      values.push(val);
    } else if (key === 'schedule') {
      sets.push(`schedule_json = ?`);
      values.push(JSON.stringify(val));
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

    const baselineChanged = ['dob', 'age', 'max_hr', 'resting_hr', 'is_max_hr_estimated', 'gender'].some(key => key in updates);
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

  const updated = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;
  return {
    ok: true,
    response: {
      profile: {
        ...updated,
        schedule: updated?.schedule_json ? JSON.parse(updated.schedule_json) : null,
        preferences: updated?.preferences_json ? JSON.parse(updated.preferences_json) : null
      },
      syncedActivitiesCount,
      syncScheduled
    }
  };
}
