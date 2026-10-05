import Database from 'better-sqlite3';
import { ageFromDob, resolveHeartRateProfile } from '../../shared/heart-rate.js';

export function getObservedPeakHeartRate(db: Database.Database, age?: number | null) {
  const threshold = age ? Math.round(208 - 0.7 * age) + 1 : 100;
  const row = db.prepare(`SELECT id, name, run_type, start_time, max_heart_rate FROM activities
    WHERE max_heart_rate BETWEEN ? AND 240
      AND (run_type IN ('race', 'intervals_vo2', 'threshold_lt2') OR (? > 0 AND max_heart_rate >= ?))
    ORDER BY max_heart_rate DESC, start_time DESC LIMIT 1`).get(threshold, age || 0, threshold) as any;
  return row ? { peakHr: row.max_heart_rate, activityId: row.id, activityName: row.name || 'Running',
    activityDate: String(row.start_time || '').slice(0, 10), runType: row.run_type || 'easy_base' } : null;
}

export function getAthleteHeartRateProfile(db: Database.Database, useThresholds = true) {
  let profile: any;
  try { profile = db.prepare("SELECT * FROM athlete_profile WHERE id = 'primary'").get(); } catch { /* optional query: schema may predate this table */ }
  const age = ageFromDob(profile?.dob, Number(profile?.age) || 0);
  let observed: ReturnType<typeof getObservedPeakHeartRate> = null;
  try { observed = getObservedPeakHeartRate(db, age); } catch { /* optional query: schema may predate this table */ }
  // Run peaks can raise the age estimate, but a submaximal run cannot lower it.
  const maxHr = observed?.peakHr;
  return { ...resolveHeartRateProfile({ age, maxHr, restingHr: profile?.resting_hr,
    lt1Hr: useThresholds ? profile?.lt1_hr : null, lt2Hr: useThresholds ? profile?.lt2_hr : null }),
    gender: profile?.gender || null };
}
