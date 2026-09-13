import { ActivityRecord } from './csv-parser';
import { DetectedInterval } from './interval-detector';

/**
 * Smart downsampling for activity time-series telemetry.
 * - For steady-state running: downsamples to 5-second intervals (sufficient for pace/HR curves).
 * - For surges, strides, and intervals: preserves high-resolution (1-2s) to capture peak speed/cadence.
 * - Retains elevation (altitude_m) for grade/ramp analysis.
 * - Strips latitude/longitude to dramatically compact database footprint.
 */
export function downsampleRecords(
  records: ActivityRecord[],
  intervals: DetectedInterval[] = []
): ActivityRecord[] {
  if (!records || records.length <= 60) return records;

  // Build active work/stride time ranges where high frequency is valuable
  const highResRanges = intervals
    .filter(i => i.type === 'work' || i.type === 'stride')
    .map(i => ({
      start: i.startSeconds,
      end: i.startSeconds + i.durationSeconds
    }));

  const downsampled: ActivityRecord[] = [];
  let lastIncludedSec = -999;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const sec = r.elapsedSeconds;
    const isFirstOrLast = i === 0 || i === records.length - 1;

    // Check if within a stride or high-intensity interval
    const isInHighResWindow = highResRanges.some(
      range => sec >= range.start - 2 && sec <= range.end + 2
    );

    // Dynamic surge check (e.g. abrupt cadence jump > 185 spm or speed > 3.4 m/s)
    const isSurge = (r.cadence ?? 0) >= 185 || (r.speedMps ?? 0) >= 3.4;

    const timeSinceLast = sec - lastIncludedSec;

    // Keep point if:
    // 1. First or last record
    // 2. High-res surge/stride window (at least every 2s)
    // 3. Steady state interval (every 5 seconds)
    const shouldKeep =
      isFirstOrLast ||
      (isInHighResWindow && timeSinceLast >= 2) ||
      (isSurge && timeSinceLast >= 1) ||
      timeSinceLast >= 5;

    if (shouldKeep) {
      downsampled.push({
        ...r,
        latitude: null,  // drop GPS lat to save space
        longitude: null  // drop GPS lon to save space
      });
      lastIncludedSec = sec;
    }
  }

  return downsampled;
}
