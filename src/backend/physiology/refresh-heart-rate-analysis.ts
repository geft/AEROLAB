import type Database from 'better-sqlite3';
import { loadAnalysisRecords } from '../db/analysis-records.js';
import { getHeartRateProfileAtDate } from './threshold-tracker.js';
import { calculateActivityTrainingLoad } from './training-load.js';
import { syncActivityCoachSummary } from './coach-summary.js';
import { withAerobicEvidenceSnapshot } from './aerobic-assessment.js';
import { withThresholdEvidenceSnapshot } from './threshold-evidence.js';
import { AEROBIC_HISTORY_DAYS } from '../../shared/aerobic-assessment.js';
import { thresholdTime } from '../../shared/threshold-trend.js';
import { LAST_SIMILAR_WINDOW_DAYS } from './coach-history.js';

/** Automatic upgrades refresh recent derived data; earlier runs remain available on demand. */
export function refreshRecentHeartRateAnalysis(db: Database.Database, asOfDate = new Date().toISOString()): number {
  const now = thresholdTime(asOfDate);
  const ids = (db.prepare('SELECT id,start_time FROM activities').all() as Array<{ id: string; start_time: string }>)
    .filter(row => thresholdTime(row.start_time) <= now && thresholdTime(row.start_time) >= now - AEROBIC_HISTORY_DAYS * 86400000)
    .map(row => row.id);
  return refreshHeartRateAnalysis(db, ids);
}

/** Refresh derived zones and verdicts without changing workout classifications. */
export function refreshHeartRateAnalysis(db: Database.Database, activityIds?: string[]): number {
  const selected = activityIds ? new Set(activityIds) : null;
  const activities = (db.prepare('SELECT id,start_time,duration_seconds,avg_heart_rate FROM activities ORDER BY julianday(start_time),id')
    .all() as Array<{ id: string; start_time: string; duration_seconds: number | null; avg_heart_rate: number | null }>)
    .filter(activity => !selected || selected.has(activity.id));
  const update = db.prepare('UPDATE activities SET training_load=?,z1_seconds=?,z2_seconds=?,z3_seconds=?,z4_seconds=?,z5_seconds=? WHERE id=?');
  if (!activities.length) return 0;
  const dates = activities.map(activity => thresholdTime(activity.start_time));
  const bounds = {
    // Coaching also evaluates the preceding similar run's historical threshold.
    fromDate: new Date(Math.min(...dates) - (AEROBIC_HISTORY_DAYS + LAST_SIMILAR_WINDOW_DAYS + 1) * 86400000).toISOString(),
    toDate: new Date(Math.max(...dates) + 86400000).toISOString()
  };
  return withThresholdEvidenceSnapshot(db, () => withAerobicEvidenceSnapshot(db, () => {
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
  }, bounds));
}
