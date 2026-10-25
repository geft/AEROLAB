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
import { distanceSeries, timeAtDistance } from './distance-series.js';
import { snapToBenchmark, type BestEffortSource } from '../../shared/best-efforts.js';

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
  /** Timing-mat result, interpolated telemetry segment, or whole-activity mean-pace fallback. */
  source: BestEffortSource;
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
  if (!records || records.length < 2 || !Number.isFinite(targetMeters) || targetMeters <= 0) return null;
  let minTime = Infinity;
  for (const points of distanceSeries(records)) {
    if (points[points.length - 1].meters - points[0].meters < targetMeters) continue;

    // A piecewise-linear distance trace has an optimal window at a recorded
    // start OR finish. Check both with monotone pointers: O(n), even for sparse GPS.
    let right = 1;
    for (let left = 0; left < points.length; left++) {
      const finishMeters = points[left].meters + targetMeters;
      while (right < points.length && points[right].meters < finishMeters) right++;
      if (right === points.length) break;
      const finishSeconds = timeAtDistance(points[right - 1], points[right], finishMeters);
      minTime = Math.min(minTime, finishSeconds - points[left].seconds);
    }

    let left = 0;
    for (let right = 1; right < points.length; right++) {
      const startMeters = points[right].meters - targetMeters;
      if (startMeters < points[0].meters) continue;
      // At a stationary plateau, use the departure time for a window's start.
      while (left + 1 < right && points[left + 1].meters <= startMeters) left++;
      const startSeconds = points[left].meters === startMeters
        ? points[left].seconds
        : timeAtDistance(points[left], points[left + 1], startMeters);
      minTime = Math.min(minTime, points[right].seconds - startSeconds);
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

/** The benchmark an official distance stands for. */
function officialBenchmark(distanceMeters: number): BestEffortTarget | undefined {
  const benchmark = snapToBenchmark(distanceMeters);
  return benchmark == null ? undefined : BEST_EFFORT_TARGETS.find(target => target.distanceMeters === benchmark);
}

/**
 * Retrieves all-time and current calendar year personal bests from database.
 */
export function getAthleteBestEfforts(db: Database.Database): BestEffortsReport {
  const currentYearStr = new Date().getFullYear().toString();

  // Find candidate activities that are long enough for standard distances. An
  // official result also qualifies regardless of recorded length: a race whose
  // watch lost signal still has a certified distance and a chip time.
  const candidateActivities = db.prepare(`
    SELECT id, name, start_time, distance_meters, duration_seconds,
           official_time_seconds, official_distance_meters
    FROM activities
    WHERE distance_meters >= 900 OR official_time_seconds IS NOT NULL
    ORDER BY start_time DESC
  `).all() as Array<{
    id: string;
    name: string;
    start_time: string;
    distance_meters: number;
    duration_seconds: number;
    official_time_seconds: number | null;
    official_distance_meters: number | null;
  }>;

  const allTimeBests = new Map<string, BestEffortRecord>();
  const currentYearBests = new Map<string, BestEffortRecord>();

  const recStmt = db.prepare(`
    SELECT elapsed_seconds, distance_m
    FROM activity_records
    WHERE activity_id = ?
    ORDER BY elapsed_seconds ASC
  `);

  const consider = (recordItem: BestEffortRecord, isThisYear: boolean): void => {
    const existingAllTime = allTimeBests.get(recordItem.targetId);
    if (!existingAllTime || recordItem.timeSeconds < existingAllTime.timeSeconds) {
      allTimeBests.set(recordItem.targetId, recordItem);
    }
    if (!isThisYear) return;
    const existingYear = currentYearBests.get(recordItem.targetId);
    if (!existingYear || recordItem.timeSeconds < existingYear.timeSeconds) {
      currentYearBests.set(recordItem.targetId, recordItem);
    }
  };

  for (const act of candidateActivities) {
    const isThisYear = act.start_time.startsWith(currentYearStr);
    const records = recStmt.all(act.id) as Array<{ elapsed_seconds: number; distance_m: number | null }>;

    const officialTime = act.official_time_seconds;
    const officialTarget = officialTime != null && act.official_distance_meters != null
      ? officialBenchmark(act.official_distance_meters)
      : undefined;

    const buildRecord = (timeSeconds: number, source: BestEffortSource, target: BestEffortTarget): BestEffortRecord => ({
      source,
      targetId: target.id,
      label: target.label,
      distanceMeters: target.distanceMeters,
      timeSeconds,
      paceSecKm: Math.round((timeSeconds / target.distanceMeters) * 1000),
      activityId: act.id,
      activityName: act.name || 'Running Activity',
      activityDate: act.start_time
    });

    for (const target of BEST_EFFORT_TARGETS) {
      // A timing mat is the measurement. The fastest-window search below is a
      // maximiser of GPS error -- one teleport invents a PB -- so an official
      // result for this distance wins outright and the trace is not consulted.
      // Comparing across activities still takes the fastest time.
      if (officialTime != null && officialTarget?.id === target.id) {
        consider(buildRecord(Math.round(officialTime), 'official', target), isThisYear);
        continue;
      }

      if (act.distance_meters < target.distanceMeters) continue;

      let fastestSec: number | null = null;
      if (records.length >= 2) {
        fastestSec = findFastestSegment(records, target.distanceMeters);
      }

      let source: BestEffortSource = 'measured';

      // Fallback approximation if records don't have cumulative distance
      if (!fastestSec && act.duration_seconds > 0) {
        fastestSec = Math.round((act.duration_seconds / act.distance_meters) * target.distanceMeters);
        source = 'estimated';
      }

      if (!fastestSec || fastestSec <= 0) continue;

      consider(buildRecord(fastestSec, source, target), isThisYear);
    }
  }

  return {
    allTime: BEST_EFFORT_TARGETS.map(t => allTimeBests.get(t.id)).filter((r): r is BestEffortRecord => Boolean(r)),
    currentYear: BEST_EFFORT_TARGETS.map(t => currentYearBests.get(t.id)).filter((r): r is BestEffortRecord => Boolean(r)),
    targets: BEST_EFFORT_TARGETS.map(t => ({ ...t }))
  };
}
