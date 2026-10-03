import type { ActivityRecord } from './csv-parser.js';
import { MAX_OBSERVED_GAP_SECONDS, sameTimerSegment } from '../physiology/time-series.js';

interface Effort {
  start: number;
  end: number;
  observed: number;
  aboveThreshold: number;
  elevated: number;
  nearMax: number;
}

/** Conservative evidence for one continuous effort above sustainable threshold.
 * Uses elapsed time and athlete-relative HR, never title, distance or pace.
 * Short HR dips are tolerated; recoveries and recording gaps separate bouts.
 */
export function continuousRaceEffort(
  records: Pick<ActivityRecord, 'elapsedSeconds' | 'heartRate' | 'cadence'>[],
  profile: { maxHr: number; restingHr: number; lt2Hr: number }
): { durationSeconds: number; nearMaxPct: number } | null {
  const { maxHr, restingHr, lt2Hr } = profile;
  const reserve = maxHr - restingHr;
  const thresholdFloor = Math.max(lt2Hr + (maxHr - lt2Hr) * 0.25, restingHr + reserve * 0.88);
  const nearMaxFloor = restingHr + reserve * 0.90;
  const efforts: Effort[] = [];
  let effort: Effort | null = null;
  let lastHardEnd = 0;
  let totalHardSeconds = 0;

  const finish = () => {
    if (effort) efforts.push(effort);
    effort = null;
  };

  for (let i = 0; i < records.length - 1; i++) {
    const record = records[i];
    const dt = records[i + 1].elapsedSeconds - record.elapsedSeconds;
    // Unobserved gaps cannot supply evidence of sustained intensity.
    if (!sameTimerSegment(record, records[i + 1]) || !Number.isFinite(dt) || dt <= 0 || dt > MAX_OBSERVED_GAP_SECONDS) {
      finish();
      continue;
    }
    const hr = record.heartRate;
    const valid = hr != null && Number.isFinite(hr) && hr > 40 && hr <= maxHr;
    const running = record.cadence == null || record.cadence >= 128;
    const hard = valid && running && hr > lt2Hr;
    if (effort && record.elapsedSeconds - lastHardEnd > 30) finish();
    if (hard) {
      totalHardSeconds += dt;
      if (!effort) effort = { start: record.elapsedSeconds, end: record.elapsedSeconds, observed: 0, aboveThreshold: 0, elevated: 0, nearMax: 0 };
      lastHardEnd = record.elapsedSeconds + dt;
      effort.end = lastHardEnd;
      effort.aboveThreshold += dt;
      if (hr >= thresholdFloor) effort.elevated += dt;
      if (hr >= nearMaxFloor) effort.nearMax += dt;
    }
    if (effort && valid && running) effort.observed += dt;
  }
  finish();

  const best = efforts.sort((a, b) => b.aboveThreshold - a.aboveThreshold)[0];
  if (!best) return null;
  const duration = best.end - best.start;
  // Repeated VO2 reps, threshold plateaus, strides and isolated HR spikes
  // cannot meet all of the sustained-volume and dominance requirements.
  if (duration < 8 * 60 || best.observed < duration * 0.80 ||
      best.aboveThreshold < duration * 0.75 || best.elevated < duration * 0.60 || best.nearMax < duration * 0.30 ||
      best.aboveThreshold < totalHardSeconds * 0.80) return null;

  return { durationSeconds: duration, nearMaxPct: best.nearMax / duration * 100 };
}
