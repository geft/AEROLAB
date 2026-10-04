import { coachingInterval, coachingRecord } from '../../domain/coaching/telemetry.js';
import { coachMessage, coachDescription } from '../../domain/coaching/messages.js';
import { category, finding } from '../../domain/coaching/vocabulary.js';
import { getLt2TrainingBand } from '../zones.js';
import { observedIntervals } from '../time-series.js';
import { band, curve, pacingConsistency, type RubricInput, type RubricFactor } from './evidence.js';

/** Assess recorded upper-aerobic execution, without claiming a planned MP target. */
export function gradeSustained(input: RubricInput): RubricFactor[] {
  const windows = (input.intervals ?? []).map(coachingInterval)
    .filter(i => i.type === 'work' && i.durationSeconds > 0)
    .map(i => ({ from: i.startSeconds, to: i.startSeconds + i.durationSeconds }));
  if (!windows.length || !input.records) return [];
  const records = input.records.map(coachingRecord);
  const workRecords = records.filter(r => windows.some(w => r.elapsedSeconds >= w.from && r.elapsedSeconds <= w.to));
  const upper = getLt2TrainingBand(input.lt2Hr)[0];
  let runningSeconds = 0;
  let observedSeconds = 0;
  let inBandSeconds = 0;
  for (const interval of observedIntervals(records, r => r.elapsedSeconds)) {
    if ((interval.a.cadence ?? 0) < 128 || (interval.b.cadence ?? 0) < 128) continue;
    // Union membership prevents overlapping interval rows from doubling time.
    const intersections = windows.map(w => ({ from: Math.max(interval.from, w.from), to: Math.min(interval.to, w.to) }))
      .filter(w => w.to > w.from).sort((a, b) => a.from - b.from);
    let end = interval.from;
    let seconds = 0;
    for (const window of intersections) {
      seconds += Math.max(0, window.to - Math.max(end, window.from));
      end = Math.max(end, window.to);
    }
    runningSeconds += seconds;
    const hr = interval.a.heartRate;
    if (hr == null || hr <= 40 || hr > input.maxHeartRate) continue;
    observedSeconds += seconds;
    if (hr > input.lt1Hr && hr < upper) inBandSeconds += seconds;
  }
  const factors: RubricFactor[] = [];
  if (observedSeconds >= 60 && observedSeconds >= runningSeconds * 0.6) {
    const pct = inBandSeconds / observedSeconds * 100;
    const points = curve(50, pct, 80, 20);
    factors.push({ ...category('sustained_intensity'), ...band(points / 50,
      finding('controlled_upper_aerobic_work'), finding('mixed_upper_aerobic_work'), finding('missed_upper_aerobic_work')),
      points: Math.round(points), maxPoints: 50,
      ...coachDescription(coachMessage('description.sustained_intensity', { pct: pct.toFixed(1), minutes: (observedSeconds / 60).toFixed(1), lower: input.lt1Hr, upper })) });
  }
  // Never fall back to whole-session splits: they include warmup and cooldown.
  const pacing = pacingConsistency(workRecords, null, input.runType);
  if (pacing) {
    const points = curve(30, pacing.rawCvPct, 3, 12);
    factors.push({ ...category('pacing_consistency'), ...band(points / 30,
      finding('steady_sustained_pacing'), finding('uneven_sustained_pacing'), finding('volatile_sustained_pacing')),
      points: Math.round(points), maxPoints: 30,
      ...coachDescription(coachMessage('description.sustained_pacing', { pct: pacing.rawCvPct.toFixed(1), count: pacing.sampleCount })) });
  }
  return factors;
}
