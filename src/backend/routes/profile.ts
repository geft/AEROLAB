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

// GET /api/profile - return athlete profile and calculated HRR zones reflecting current LT1/LT2
profileRouter.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const profile = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const currentThresholds = getCurrentThresholds(db);
    const ageVal = Number(profile.age) || 37;
    const tanakaMaxHr = Math.round(208 - 0.7 * ageVal);
    const observedPeak = getObservedPeakHeartRate(db, ageVal);

    let effectiveMaxHr = profile.max_hr || 203;
    let maxHrSource: 'manual' | 'observed_run' | 'tanaka_formula' = 'manual';

    if (profile.is_max_hr_estimated) {
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
        max_hr: effectiveMaxHr,
        schedule: profile.schedule_json ? JSON.parse(profile.schedule_json) : null,
        preferences: profile.preferences_json ? JSON.parse(profile.preferences_json) : null
      },
      currentThresholds,
      zones,
      observedPeakHr: observedPeak,
      tanakaMaxHr,
      effectiveMaxHr,
      maxHrSource
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
      'favorite_route'
    ];

    const existing = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;
    const ageVal = Number(updates.age) || Number(existing?.age) || 37;
    const tanakaMax = Math.round(208 - 0.7 * ageVal);
    const observedPeak = getObservedPeakHeartRate(db, ageVal);

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
      updates.max_hr = Number(updates.max_hr);
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
      syncedActivitiesCount = syncAllCoachSummaries(db);
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
    res.status(500).json({ error: err.message });
  }
});
