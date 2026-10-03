import type Database from 'better-sqlite3';
import { realignDatabase, type RealignStats } from '../../db/realign.js';
import { thresholdTime } from '../../../shared/threshold-trend.js';
import type { PrecomputedWorkoutMetrics } from './analyze-workout.js';

export interface HistoryRebuildOptions {
  /** Earliest old/new workout time; omit to rebuild after a baseline change. */
  fromTime?: number;
  precomputed?: Map<string, PrecomputedWorkoutMetrics>;
  onProgress?: (completed: number, total: number) => void;
}

/** Includes same-time workouts and orders them consistently with chronological replay. */
export function affectedActivityIds(db: Database.Database, fromTime = -Infinity): string[] {
  return (db.prepare('SELECT id,start_time FROM activities').all() as Array<{ id: string; start_time: string }>)
    .filter(activity => thresholdTime(activity.start_time) >= fromTime)
    .sort((a, b) => thresholdTime(a.start_time) - thresholdTime(b.start_time) || a.id.localeCompare(b.id))
    .map(activity => activity.id);
}

/** Strict correction: the entire affected history commits or rolls back together.
 * Standalone maintenance can still use realignDatabase's best-effort policy.
 */
export function rebuildAffectedHistory(db: Database.Database, options: HistoryRebuildOptions = {}): RealignStats {
  return db.transaction(() => {
    const ids = affectedActivityIds(db, options.fromTime);
    // An empty explicit list means "all" to the legacy realigner. Avoid that fallback.
    if (!ids.length) return { activitiesProcessed: 0, activitiesSkipped: 0, activitiesFailed: [],
      runTypeChanges: [], intervalsRebuilt: 0, thresholdsPruned: 0, profileLt1Hr: null, profileLt2Hr: null };
    const remove = db.prepare("DELETE FROM physiological_thresholds WHERE source_activity_id = ? AND source_kind = 'workout'");
    let pruned = 0;
    for (const id of ids) pruned += remove.run(id).changes;
    const replayOptions = { activityIds: ids, precomputed: options.precomputed, onProgress: options.onProgress, strict: true };
    const result = realignDatabase(db, replayOptions);
    if (result.activitiesFailed.length) throw new Error(`Dependent reanalysis failed: ${result.activitiesFailed.join('; ')}`);
    result.thresholdsPruned += pruned;
    return result;
  })();
}
