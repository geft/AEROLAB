/**
 * Wire contracts for GET /api/activities/best-efforts.
 */

/** One tracked benchmark distance. */
export interface BestEffortTarget {
  id: string;
  label: string;
  distanceMeters: number;
}

/**
 * How a personal best was obtained.
 *
 * - `official`: timing-mat result entered against the run; authoritative.
 * - `measured`: fastest window found inside the recorded trace.
 * - `estimated`: whole-run mean pace scaled to the benchmark distance.
 */
export type BestEffortSource = 'measured' | 'estimated' | 'official';

/** Benchmark distances tracked by the personal bests report. */
export const BENCHMARK_DISTANCES: readonly number[] = [1000, 5000, 10000, 21097.5, 42195];

/**
 * The benchmark distance a recorded distance most likely represents.
 *
 * A course is certified but the watch is not: a 10 km race routinely records as
 * 9.94 - 10.06 km. Returns null when the recording is too far from every
 * benchmark to assume one, so a 12 km trail run is never rounded to a half
 * marathon.
 */
export function snapToBenchmark(distanceMeters: number | null | undefined, tolerancePct = 2): number | null {
  if (distanceMeters == null || !Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
  let best: number | null = null;
  let bestError = Infinity;
  for (const benchmark of BENCHMARK_DISTANCES) {
    const error = Math.abs(distanceMeters - benchmark) / benchmark;
    if (error <= tolerancePct / 100 && error < bestError) {
      best = benchmark;
      bestError = error;
    }
  }
  return best;
}

/** A personal best effort over a benchmark distance. */
export interface BestEffortRecord {
  /** Missing only in older offline snapshots. */
  source?: BestEffortSource;
  targetId: string;
  label: string;
  distanceMeters: number;
  timeSeconds: number;
  paceSecKm: number;
  activityId: string;
  activityName: string;
  activityDate: string;
}

/** GET /api/activities/best-efforts */
export interface BestEffortsReport {
  allTime: BestEffortRecord[];
  currentYear: BestEffortRecord[];
  targets: BestEffortTarget[];
}
