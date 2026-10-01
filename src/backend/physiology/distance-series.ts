export interface DistanceRecord {
  elapsed_seconds?: number | null;
  elapsedSeconds?: number | null;
  distance_m?: number | null;
  distanceMeters?: number | null;
}

export interface DistancePoint<T> {
  seconds: number;
  meters: number;
  record: T;
}

/** Preserve plateaus (pauses), but never interpolate across corrupt readings or resets. */
export function* distanceSeries<T extends DistanceRecord>(records: T[]): Generator<DistancePoint<T>[]> {
  let points: DistancePoint<T>[] = [];
  for (const record of records) {
    const seconds = record.elapsed_seconds ?? record.elapsedSeconds;
    const meters = record.distance_m ?? record.distanceMeters;
    if (seconds == null || meters == null || !Number.isFinite(seconds) || !Number.isFinite(meters) || seconds < 0 || meters < 0) {
      if (points.length > 1) yield points;
      points = [];
      continue;
    }
    const previous = points[points.length - 1];
    if (previous && (seconds <= previous.seconds || meters < previous.meters)) {
      if (points.length > 1) yield points;
      points = [];
    }
    points.push({ seconds, meters, record });
  }
  if (points.length > 1) yield points;
}

/** Call only on a pair with strictly increasing distance. */
export function timeAtDistance<T>(start: DistancePoint<T>, end: DistancePoint<T>, meters: number): number {
  return start.seconds + (end.seconds - start.seconds) * (meters - start.meters) / (end.meters - start.meters);
}
