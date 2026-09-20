/**
 * AEROLAB Personal Bests / Best Efforts Tracker
 *
 * Scans activities and second-by-second distance telemetry to extract
 * peak continuous efforts for standard benchmarks: 1k, 5k, 10k, Half Marathon, Marathon.
 *
 * Every target is always reported through `targets` so the UI can render an
 * empty placeholder tile for distances the athlete has not covered yet.
 */

import Database from 'better-sqlite3';

export interface BestEffortTarget {
  id: '1k' | '5k' | '10k' | 'hm' | 'mar';
  label: string;
  distanceMeters: number;
}

export const BEST_EFFORT_TARGETS: BestEffortTarget[] = [
  { id: '1k', label: '1 km', distanceMeters: 1000 },
  { id: '5k', label: '5 km', distanceMeters: 5000 },
  { id: '10k', label: '10 km', distanceMeters: 10000 },
  { id: 'hm', label: 'Half Marathon', distanceMeters: 21097.5 },
  { id: 'mar', label: 'Marathon', distanceMeters: 42195 }
];

export interface BestEffortRecord {
  targetId: string;
  label: string;
  distanceMeters: number;
  timeSeconds: number;
  paceSecKm: number;
  activityId: string;
  activityName: string;
  activityDate: string;
}

/**
 * Calculates the fastest elapsed window for a target distance from second-by-second records.
 */
export function findFastestSegment(
  records: Array<{ elapsed_seconds?: number | null; elapsedSeconds?: number | null; distance_m?: number | null; distanceMeters?: number | null }>,
  targetMeters: number
): number | null {
  if (!records || records.length < 2) return null;

  const n = records.length;
  const firstDist = records[0].distance_m ?? records[0].distanceMeters ?? 0;
  const lastDist = records[n - 1].distance_m ?? records[n - 1].distanceMeters ?? 0;
  const totalCovered = lastDist - firstDist;

  if (totalCovered < targetMeters) return null;

  let minTime = Infinity;
  let right = 0;

  for (let left = 0; left < n; left++) {
    const leftDist = records[left].distance_m ?? records[left].distanceMeters ?? 0;
    const leftSec = records[left].elapsed_seconds ?? records[left].elapsedSeconds ?? 0;

    while (right < n) {
      const rightDist = records[right].distance_m ?? records[right].distanceMeters ?? 0;
      if (rightDist - leftDist >= targetMeters) {
        const rightSec = records[right].elapsed_seconds ?? records[right].elapsedSeconds ?? 0;
        const dt = rightSec - leftSec;
        if (dt > 0 && dt < minTime) {
          minTime = dt;
        }
        break;
      }
      right++;
    }
  }

  return Number.isFinite(minTime) && minTime > 0 ? Math.round(minTime) : null;
}

export interface BestEffortsReport {
  allTime: BestEffortRecord[];
  currentYear: BestEffortRecord[];
  /** Ordered list of every tracked benchmark distance (records may be missing). */
  targets: BestEffortTarget[];
}

/**
 * Retrieves all-time and current calendar year personal bests from database.
 */
export function getAthleteBestEfforts(db: Database.Database): BestEffortsReport {
  const currentYearStr = new Date().getFullYear().toString();

  // Find candidate activities that are long enough for standard distances
  const candidateActivities = db.prepare(`
    SELECT id, name, start_time, distance_meters, duration_seconds
    FROM activities
    WHERE distance_meters >= 900
    ORDER BY start_time DESC
  `).all() as Array<{
    id: string;
    name: string;
    start_time: string;
    distance_meters: number;
    duration_seconds: number;
  }>;

  const allTimeBests = new Map<string, BestEffortRecord>();
  const currentYearBests = new Map<string, BestEffortRecord>();

  const recStmt = db.prepare(`
    SELECT elapsed_seconds, distance_m
    FROM activity_records
    WHERE activity_id = ? AND distance_m IS NOT NULL
    ORDER BY elapsed_seconds ASC
  `);

  for (const act of candidateActivities) {
    const isThisYear = act.start_time.startsWith(currentYearStr);
    const records = recStmt.all(act.id) as Array<{ elapsed_seconds: number; distance_m: number }>;

    for (const target of BEST_EFFORT_TARGETS) {
      if (act.distance_meters < target.distanceMeters) continue;

      let fastestSec: number | null = null;
      if (records.length > 5) {
        fastestSec = findFastestSegment(records, target.distanceMeters);
      }

      // Fallback approximation if records don't have cumulative distance
      if (!fastestSec && act.distance_meters >= target.distanceMeters && act.duration_seconds > 0) {
        fastestSec = Math.round((act.duration_seconds / act.distance_meters) * target.distanceMeters);
      }

      if (!fastestSec || fastestSec <= 0) continue;

      const paceSecKm = Math.round((fastestSec / target.distanceMeters) * 1000);
      const recordItem: BestEffortRecord = {
        targetId: target.id,
        label: target.label,
        distanceMeters: target.distanceMeters,
        timeSeconds: fastestSec,
        paceSecKm,
        activityId: act.id,
        activityName: act.name || 'Running Activity',
        activityDate: act.start_time
      };

      const existingAllTime = allTimeBests.get(target.id);
      if (!existingAllTime || recordItem.timeSeconds < existingAllTime.timeSeconds) {
        allTimeBests.set(target.id, recordItem);
      }

      if (isThisYear) {
        const existingYear = currentYearBests.get(target.id);
        if (!existingYear || recordItem.timeSeconds < existingYear.timeSeconds) {
          currentYearBests.set(target.id, recordItem);
        }
      }
    }
  }

  return {
    allTime: BEST_EFFORT_TARGETS.map(t => allTimeBests.get(t.id)).filter((r): r is BestEffortRecord => Boolean(r)),
    currentYear: BEST_EFFORT_TARGETS.map(t => currentYearBests.get(t.id)).filter((r): r is BestEffortRecord => Boolean(r)),
    targets: BEST_EFFORT_TARGETS.map(t => ({ ...t }))
  };
}
