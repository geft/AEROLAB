import { Router } from 'express';
import { getDatabase } from '../db/client.js';
import { getDefaultZones } from '../physiology/zones.js';
import { syncAllCoachSummaries } from '../physiology/coach-summary.js';
import { getCurrentThresholds } from '../physiology/threshold-tracker.js';

export const profileRouter = Router();

export interface ObservedPeakHeartRate {
  peakHr: number;
  activityId: string;
  activityName: string;
  activityDate: string;
  runType: string;
}

export function getObservedPeakHeartRate(db: any, age: number = 37): ObservedPeakHeartRate | null {
  try {
    const tanakaFallback = Math.round(208 - 0.7 * age);
    // Minimum threshold for an observed effort to qualify as a peak HR candidate:
    // Either from a high-effort run type ('race', 'intervals_vo2', 'threshold_lt2'),
    // OR reaching at least 82% of age-predicted max.
    const minQualifyingHr = Math.round(tanakaFallback * 0.82);
    const row = db.prepare(`
      SELECT id, name, run_type, start_time, max_heart_rate, avg_heart_rate
      FROM activities
      WHERE max_heart_rate IS NOT NULL
        AND max_heart_rate >= ?
        AND (run_type IN ('race', 'intervals_vo2', 'threshold_lt2') OR max_heart_rate >= 165)
      ORDER BY max_heart_rate DESC, start_time DESC
      LIMIT 1
    `).get(minQualifyingHr) as any;

    if (!row || !row.max_heart_rate) return null;

    return {
      peakHr: row.max_heart_rate,
      activityId: row.id,
      activityName: row.name || 'Quality Effort',
      activityDate: row.start_time ? String(row.start_time).slice(0, 10) : '',
      runType: row.run_type || 'race'
    };
  } catch {
    return null;
  }
}

export function calculateAgeFromDob(dob?: string | null, fallbackAge: number = 35): number {
  if (!dob) return fallbackAge;
  const parts = dob.trim().split('-');
  const year = parseInt(parts[0], 10);
  const month = parts[1] ? parseInt(parts[1], 10) - 1 : 0;
  const day = parts[2] ? parseInt(parts[2], 10) : 1;
  if (isNaN(year) || year < 1900 || year > 2100) return fallbackAge;

  const birthDate = new Date(year, month, day);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age > 0 ? age : fallbackAge;
}

// GET /api/profile - return athlete profile and calculated HRR zones reflecting current LT1/LT2
profileRouter.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const profile = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const hasRequiredBaselines = Boolean(profile.dob && profile.resting_hr);
    const isConfigured = profile.is_configured === 1 && hasRequiredBaselines;

    const currentThresholds = getCurrentThresholds(db);
    const dynamicAge = calculateAgeFromDob(profile.dob, Number(profile.age) || 35);
    const tanakaMaxHr = Math.round(208 - 0.7 * dynamicAge);
    const observedPeak = getObservedPeakHeartRate(db, dynamicAge);

    let effectiveMaxHr = profile.max_hr || tanakaMaxHr;
    let maxHrSource: 'manual' | 'observed_run' | 'tanaka_formula' = profile.max_hr ? 'manual' : 'tanaka_formula';

    if (profile.is_max_hr_estimated || (observedPeak && observedPeak.peakHr > effectiveMaxHr)) {
      if (observedPeak && observedPeak.peakHr >= 140) {
        effectiveMaxHr = observedPeak.peakHr;
        maxHrSource = 'observed_run';
      } else {
        effectiveMaxHr = tanakaMaxHr;
        maxHrSource = 'tanaka_formula';
      }
    }

    const zones = getDefaultZones(
      effectiveMaxHr,
      currentThresholds.lt1Hr,
      currentThresholds.lt2Hr,
      profile.resting_hr || 55
    );

    res.json({
      profile: {
        ...profile,
        age: dynamicAge,
        is_configured: isConfigured ? 1 : 0,
        max_hr: effectiveMaxHr,
        schedule: profile.schedule_json ? JSON.parse(profile.schedule_json) : null,
        preferences: profile.preferences_json ? JSON.parse(profile.preferences_json) : null
      },
      currentThresholds,
      zones,
      observedPeakHr: observedPeak,
      tanakaMaxHr,
      effectiveMaxHr,
      maxHrSource,
      isConfigured
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/profile - update athlete profile
profileRouter.patch('/', (req, res) => {
  try {
    const db = getDatabase();
    const updates = req.body;

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
      ageVal = calculateAgeFromDob(updates.dob, Number(updates.age) || Number(existing?.age) || 35);
      updates.age = ageVal;
    } else {
      ageVal = Number(updates.age) || calculateAgeFromDob(existing?.dob, Number(existing?.age) || 35);
    }

    const tanakaMax = Math.round(208 - 0.7 * ageVal);
    const observedPeak = getObservedPeakHeartRate(db, ageVal);

    // Safeguard resting_hr from accidental reset or corruption
    if (updates.resting_hr !== undefined) {
      if (updates.resting_hr === null || updates.resting_hr === '') {
        return res.status(400).json({
          code: 'ERR_INVALID_RESTING_HR',
          error: 'Resting heart rate cannot be null or empty'
        });
      }
      const parsedRhr = Number(updates.resting_hr);
      if (isNaN(parsedRhr) || parsedRhr < 30 || parsedRhr > 120) {
        return res.status(400).json({
          code: 'ERR_INVALID_RESTING_HR',
          error: 'Resting heart rate must be a valid number between 30 and 120 bpm'
        });
      }
      updates.resting_hr = Math.round(parsedRhr);
    }

    // Handle Max HR Opt-Out / Estimation:
    // If opting out of manual entry, prefer observed peak from real hard runs; otherwise fall back to Tanaka formula
    if (updates.opt_out_max_hr || updates.is_max_hr_estimated) {
      if (observedPeak && observedPeak.peakHr >= 140) {
        updates.max_hr = observedPeak.peakHr;
      } else {
        updates.max_hr = tanakaMax;
      }
      updates.is_max_hr_estimated = 1;
    } else if (updates.max_hr !== undefined && !updates.is_max_hr_estimated) {
      const parsedMax = Number(updates.max_hr);
      if (isNaN(parsedMax) || parsedMax < 100 || parsedMax > 240) {
        return res.status(400).json({
          code: 'ERR_INVALID_MAX_HR',
          error: 'Max heart rate must be a valid number between 100 and 240 bpm'
        });
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
    if (sets.length > 0) {
      sets.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push('primary');
      db.prepare(`UPDATE athlete_profile SET ${sets.join(', ')} WHERE id = ?`).run(...values);

      // Continuously update all coach summaries across all activities using updated profile thresholds
      try {
        syncedActivitiesCount = syncAllCoachSummaries(db);
      } catch (syncErr: any) {
        console.error('Non-fatal coach summary sync error during profile update:', syncErr.message);
      }
    }

    const updated = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;
    res.json({
      profile: {
        ...updated,
        schedule: updated.schedule_json ? JSON.parse(updated.schedule_json) : null,
        preferences: updated.preferences_json ? JSON.parse(updated.preferences_json) : null
      },
      syncedActivitiesCount
    });
  } catch (err: any) {
    console.error('PATCH /api/profile failed:', err);
    res.status(500).json({
      code: 'ERR_PROFILE_SAVE_FAILED',
      error: err.message || 'Database error while saving athlete profile',
      details: err.stack || String(err)
    });
  }
});
