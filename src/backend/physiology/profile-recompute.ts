import Database from 'better-sqlite3';
import { getHeartRateProfileAtDate } from './threshold-tracker.js';
import { calculateActivityTrainingLoad } from './training-load.js';
import { syncAllCoachSummaries } from './coach-summary.js';

/** Rebuild derived values after a profile edit, off the API thread in normal use. */
export function recomputeProfileDerivedData(db: Database.Database, baselineChanged: boolean): number {
  if (baselineChanged) {
    const activities = db.prepare('SELECT id, start_time, duration_seconds, avg_heart_rate FROM activities').all() as Array<{
      id: string; start_time: string; duration_seconds: number; avg_heart_rate: number | null;
    }>;
    const selectRecords = db.prepare('SELECT elapsed_seconds, heart_rate FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds');
    const updateLoad = db.prepare('UPDATE activities SET training_load = ?, z1_seconds = ?, z2_seconds = ?, z3_seconds = ?, z4_seconds = ?, z5_seconds = ? WHERE id = ?');
    db.transaction(() => {
      for (const activity of activities) {
        const hrProfile = getHeartRateProfileAtDate(db, activity.start_time);
        const load = calculateActivityTrainingLoad(selectRecords.all(activity.id) as Array<{ elapsed_seconds: number; heart_rate: number | null }>, hrProfile,
          { durationSeconds: activity.duration_seconds, avgHeartRate: activity.avg_heart_rate });
        updateLoad.run(load.trainingLoad, load.zones.z1Seconds, load.zones.z2Seconds, load.zones.z3Seconds, load.zones.z4Seconds, load.zones.z5Seconds, activity.id);
      }
    })();
  }
  return syncAllCoachSummaries(db);
}
