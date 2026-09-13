import { Router } from 'express';
import { getDatabase } from '../db/client.js';
import { getDefaultZones } from '../physiology/zones.js';
import { syncAllCoachSummaries } from '../physiology/coach-summary.js';
import { getCurrentThresholds } from '../physiology/threshold-tracker.js';

export const profileRouter = Router();

// GET /api/profile - return athlete profile and calculated HRR zones reflecting current LT1/LT2
profileRouter.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const profile = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const currentThresholds = getCurrentThresholds(db);
    const zones = getDefaultZones(
      profile.max_hr || 203,
      currentThresholds.lt1Hr,
      currentThresholds.lt2Hr,
      profile.resting_hr || 55
    );

    res.json({
      profile: {
        ...profile,
        schedule: profile.schedule_json ? JSON.parse(profile.schedule_json) : null,
        preferences: profile.preferences_json ? JSON.parse(profile.preferences_json) : null
      },
      currentThresholds,
      zones
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
      'age', 'height_cm', 'weight_kg', 'resting_hr', 'max_hr',
      'lt1_hr', 'lt2_hr', 'lt1_min_hr', 'lt1_max_hr',
      'z3_start_hr', 'z4_start_hr', 'hr_metric', 'vo2_max',
      'goal_marathon', 'upcoming_benchmark', 'pb_5k', 'pb_hm',
      'shoe_threshold', 'shoe_easy', 'shoe_retired', 'location',
      'favorite_route'
    ];

    if (updates.lt1_hr && updates.z3_start_hr === undefined) {
      updates.z3_start_hr = updates.lt1_hr + 1;
    }
    if (updates.lt2_hr && updates.z4_start_hr === undefined) {
      updates.z4_start_hr = updates.lt2_hr;
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
