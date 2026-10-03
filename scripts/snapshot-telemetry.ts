import type { ActivityInterval, ActivityRecord } from '../src/shared/contracts/activity-detail.js';

export const SNAPSHOT_TELEMETRY_SECONDS = 30;
const BEFORE_SHORT_EFFORT_SECONDS = 10;
const AFTER_SHORT_EFFORT_SECONDS = 60;
const INTERVAL_BOUNDARY_SECONDS = 5;

/** Display-only sampling after analysis; all returned measurements are original samples. */
export function sampleSnapshotTelemetry(
  records: readonly ActivityRecord[],
  intervals: readonly ActivityInterval[]
): ActivityRecord[] {
  if (records.length <= 2) return [...records];

  const protectedWindows = intervals.flatMap(interval => {
    const start = interval.start_seconds;
    const end = start + interval.duration_seconds;
    const shortEffort = interval.type === 'stride' || (interval.type === 'work' && interval.duration_seconds <= 120);
    return shortEffort
      ? [[start - BEFORE_SHORT_EFFORT_SECONDS, end + AFTER_SHORT_EFFORT_SECONDS]]
      : [[start - INTERVAL_BOUNDARY_SECONDS, start + INTERVAL_BOUNDARY_SECONDS], [end - INTERVAL_BOUNDARY_SECONDS, end + INTERVAL_BOUNDARY_SECONDS]];
  });
  const selected = new Set([0, records.length - 1]);
  const buckets = new Map<number, number>();
  const extrema = new Map<string, { minimum: number; maximum: number }>();

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const time = record.elapsed_seconds;
    if (protectedWindows.some(([start, end]) => time >= start && time <= end)) selected.add(index);

    const bucket = Math.floor(time / SNAPSHOT_TELEMETRY_SECONDS);
    const midpoint = (bucket + 0.5) * SNAPSHOT_TELEMETRY_SECONDS;
    const previousIndex = buckets.get(bucket);
    if (previousIndex === undefined || Math.abs(time - midpoint) < Math.abs(records[previousIndex].elapsed_seconds - midpoint)) {
      buckets.set(bucket, index);
    }

    if (index > 0) {
      const previous = records[index - 1];
      const stopTransition = ((record.speed_mps ?? 0) < 1) !== ((previous.speed_mps ?? 0) < 1);
      const gap = time - previous.elapsed_seconds > SNAPSHOT_TELEMETRY_SECONDS * 2;
      if (stopTransition || gap || record.timerActive !== previous.timerActive) {
        selected.add(index - 1);
        selected.add(index);
      }
    }

    // Retain chart-scale extrema so sampling does not change the visible ranges.
    for (const field of ['heart_rate', 'speed_mps', 'altitude_m'] as const) {
      const value = record[field];
      if (value == null || !Number.isFinite(value)) continue;
      if (field === 'heart_rate' && value <= 50) continue;
      if (field === 'speed_mps' && (value < 1000 / 600 || value > 1000 / 180)) continue;
      const range = extrema.get(field);
      if (!range) extrema.set(field, { minimum: index, maximum: index });
      else {
        if (value < records[range.minimum][field]!) range.minimum = index;
        if (value > records[range.maximum][field]!) range.maximum = index;
      }
    }
  }

  for (const index of buckets.values()) selected.add(index);
  for (const { minimum, maximum } of extrema.values()) {
    selected.add(minimum);
    selected.add(maximum);
  }
  return [...selected].sort((a, b) => a - b).map(index => records[index]);
}
