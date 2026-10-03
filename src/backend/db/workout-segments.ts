import type Database from 'better-sqlite3';
import type { SplitLap } from '../physiology/economy.js';
import type { DetectedInterval } from '../ingestion/interval-detector.js';

/** Import and replay persist identical normalized segment fields. Caller owns transaction. */
export function persistWorkoutSegments(db: Database.Database, activityId: string, splits: SplitLap[], intervals: DetectedInterval[], preserveEmptySplits = false): void {
  db.prepare('DELETE FROM activity_intervals WHERE activity_id = ?').run(activityId);
  if (!preserveEmptySplits || splits.length) db.prepare('DELETE FROM activity_splits WHERE activity_id = ?').run(activityId);
  const insertSplit = db.prepare(`
    INSERT INTO activity_splits (
      activity_id, split_index, distance_meters, duration_seconds,
      avg_pace_sec_km, avg_heart_rate, split_efficiency_factor, elevation_change_m,
      avg_cadence, avg_stance_time, avg_vert_osc, avg_vert_ratio
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertInterval = db.prepare(`
    INSERT INTO activity_intervals (
      activity_id, interval_index, type, start_seconds, duration_seconds,
      distance_meters, avg_speed_mps, avg_pace_sec_km, avg_heart_rate,
      max_heart_rate, avg_cadence, peak_cadence, peak_speed_mps, peak_pace_sec_km,
      min_stance_time, hr_drop, avg_vert_osc, avg_stance_time,
      avg_step_length, avg_stride_length, avg_vert_ratio
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

    // Splits
    for (const s of splits) {
      insertSplit.run(
        activityId,
        s.splitIndex,
        s.distanceMeters,
        s.durationSeconds,
        s.avgPaceSecKm,
        s.avgHeartRate,
        s.splitEfficiencyFactor,
        s.elevationChangeM,
        s.avgCadence ?? null,
        s.avgStanceTimeMs ?? null,
        s.avgVertOscMm ?? null,
        s.avgVertRatioPct ?? null
      );
    }

    // Intervals
    for (const inv of intervals) {
      insertInterval.run(
        activityId,
        inv.intervalIndex,
        inv.type,
        inv.startSeconds,
        inv.durationSeconds,
        inv.distanceMeters,
        inv.avgSpeedMps,
        inv.avgPaceSecKm,
        inv.avgHeartRate,
        inv.maxHeartRate,
        inv.avgCadence,
        inv.peakCadence ?? null,
        inv.peakSpeedMps ?? null,
        inv.peakPaceSecKm ?? null,
        inv.minStanceTime ?? null,
        inv.hrDrop ?? null,
        inv.avgVertOsc ?? null,
        inv.avgStanceTime ?? null,
        inv.avgStepLength ?? null,
        inv.avgStrideLength ?? null,
        inv.avgVertRatio ?? null
      );
    }

}
