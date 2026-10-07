import type Database from 'better-sqlite3';
import { loadAnalysisRecords } from '../db/analysis-records.js';
import { getHeartRateProfileAtDate } from './threshold-tracker.js';
import { calculateActivityTrainingLoad } from './training-load.js';
import { syncActivityCoachSummary } from './coach-summary.js';

/** Refresh derived zones and verdicts without changing workout classifications. */
export function refreshHeartRateAnalysis(db: Database.Database, activityIds?: string[]): number {
  const selected = activityIds ? new Set(activityIds) : null;
  const activities = (db.prepare('SELECT id,start_time,duration_seconds,avg_heart_rate FROM activities ORDER BY julianday(start_time),id')
    .all() as Array<{ id: string; start_time: string; duration_seconds: number | null; avg_heart_rate: number | null }>)
    .filter(activity => !selected || selected.has(activity.id));
  const update = db.prepare('UPDATE activities SET training_load=?,z1_seconds=?,z2_seconds=?,z3_seconds=?,z4_seconds=?,z5_seconds=? WHERE id=?');
  for (const activity of activities) {
    const profile = getHeartRateProfileAtDate(db, activity.start_time, activity.id);
    const load = calculateActivityTrainingLoad(loadAnalysisRecords(db, activity.id), profile,
      { durationSeconds: activity.duration_seconds, avgHeartRate: activity.avg_heart_rate });
    db.transaction(() => {
      update.run(load.trainingLoad, load.zones.z1Seconds, load.zones.z2Seconds, load.zones.z3Seconds,
        load.zones.z4Seconds, load.zones.z5Seconds, activity.id);
      if (!syncActivityCoachSummary(db, activity.id)) throw new Error(`Missing activity during analysis refresh: ${activity.id}`);
    })();
  }
  return activities.length;
}
