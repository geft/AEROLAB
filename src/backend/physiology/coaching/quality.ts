import { category, finding } from '../../domain/coaching/vocabulary.js';
import { getLt2TrainingBand } from '../zones.js';
import { RubricFactor, RubricInput, curve, band, coefficientOfVariation, INTERVAL_TYPE, intervalDuration, intervalHr, intervalMaxHr, WalkAudit, describeSet, walkSharePct, turnoverFactor, setFatigueDetail, intensityControlPoints } from './evidence.js';
export function thresholdZoneShare(input: RubricInput): { pct: number; seconds: number; lower: number; upper: number } | null {
  const workWindows = (input.intervals || [])
    .filter((rep: any) => rep.type === INTERVAL_TYPE.work)
    .map((rep: any) => ({ from: rep.start_seconds ?? rep.startSeconds, to: (rep.start_seconds ?? rep.startSeconds) + intervalDuration(rep) }))
    .filter((window: { from: number; to: number }) => Number.isFinite(window.from) && window.to > window.from);
  if (workWindows.length === 0 || !input.records || input.records.length < 10) return null;
  const [lower, upper] = getLt2TrainingBand(input.lt2Hr);
  let observed = 0;
  let inZone = 0;
  const records = input.records;
  for (let index = 0; index < records.length - 1; index++) {
    const record = records[index];
    const time = record.elapsed_seconds ?? record.elapsedSeconds;
    const nextTime = records[index + 1].elapsed_seconds ?? records[index + 1].elapsedSeconds;
    const hr = record.heart_rate ?? record.heartRate;
    if (!Number.isFinite(time) || !Number.isFinite(nextTime) || !Number.isFinite(hr) || hr <= 40) continue;
    for (const window of workWindows) {
      const seconds = Math.max(0, Math.min(nextTime, window.to, time + 15) - Math.max(time, window.from));
      observed += seconds;
      if (hr >= lower && hr <= upper) inZone += seconds;
    }
  }
  if (observed < 60) return null;
  return { pct: (inZone / observed) * 100, seconds: Math.round(inZone), lower, upper };
}

export function gradeQuality(input: RubricInput, walkAudit: WalkAudit | null): RubricFactor[] {
  const factors: RubricFactor[] = [];
  const isThreshold = input.runType === 'threshold_lt2';
  const workReps = (input.intervals || []).filter((i: any) => i.type === INTERVAL_TYPE.work);

  if (isThreshold) {
    const zone = thresholdZoneShare(input);
    if (zone) {
      const max = 50;
      const pts = curve(max, zone.pct, 70, 10);
      factors.push({
        ...(category('threshold_zone_time')), points: Math.round(pts), maxPoints: max,
        ...(band(pts / max, finding('sustained_threshold_heart_rate'), finding('partial_threshold_exposure'), finding('little_threshold_exposure'))),
        description: `${Math.floor(zone.seconds / 60)}m ${String(zone.seconds % 60).padStart(2, '0')}s within the LT2 band (${zone.lower}-${zone.upper} bpm), ${zone.pct.toFixed(1)}% of observed work-rep time`
      });
    }
  }

  // 1. Interval structure consistency — 22 pts
  const durations = workReps.map(intervalDuration).filter((d: number) => d > 0);
  const durationStats = coefficientOfVariation(durations);
  // Stride-length reps are too short for duration consistency to mean anything.
  const repsLongEnough = (describeSet(input.intervals)?.medianRepSec ?? 0) >= 20;
  if (durationStats && repsLongEnough) {
    const max = isThreshold ? 10 : 22;
    const cvPct = durationStats.cv * 100;
    const pts = curve(max, cvPct, 6, 25);
    factors.push({
      ...(category('interval_execution')),
      points: Math.round(pts),
      maxPoints: max,
      ...(band(pts / max, finding('laser_rep_consistency'), finding('disciplined_interval_structure'), finding('high_rep_variance_across_set'))),
      description: `${cvPct.toFixed(1)}% duration variance across ${workReps.length} reps (±${Math.round(durationStats.stdDev)}s spread)`
    });
  }

  // 2. Cardiovascular stimulus (peak work HR as a share of HRmax) — 20 pts
  const peakHr = Math.max(0, ...workReps.map(intervalMaxHr), input.activityMaxHr || 0);
  if (!isThreshold && peakHr > 0 && input.maxHeartRate > 0) {
    const max = 20;
    const pctMax = (peakHr / input.maxHeartRate) * 100;
    const pts = curve(max, pctMax, 90, 75);
    factors.push({
      ...(category('cardiovascular_stimulus')),
      points: Math.round(pts),
      maxPoints: max,
      ...(band(pts / max, finding('target_vo2_stimulus_achieved'), finding('partial_cardiovascular_stimulus'), finding('insufficient_cardiovascular_stimulus'))),
      description: `Peaked at ${peakHr} bpm (${Math.round(pctMax)}% HRmax)`
    });
  }

  // 3. Intensity control (work HR held at the session's anchor) — 20 pts
  const shape = describeSet(input.intervals);
  const workHrsAll = workReps.map(intervalHr).filter((h: number) => h > 0);
  const peakWorkHr = Math.max(0, ...workReps.map(intervalMaxHr));
  // The *anchor* comes from the session's intent, never from whatever heart rate
  // showed up: a threshold session that drifts upward is over-intensity for its
  // purpose, not a VO2 session that should be congratulated. Only the measurement
  // method adapts to rep length, because heart rate lags inside short reps.
  const vo2Target = input.runType === 'intervals_vo2';
  const usePeak = !!shape?.shortReps;
  const avgWorkHr = workHrsAll.length > 0
    ? Math.round(workHrsAll.reduce((a: number, b: number) => a + b, 0) / workHrsAll.length)
    : 0;
  const anchorHr = usePeak && peakWorkHr > 0 ? peakWorkHr : avgWorkHr;
  if (anchorHr > 0) {
    const max = isThreshold ? 15 : 20;
    const pts = intensityControlPoints(max, anchorHr, input.lt2Hr, input.maxHeartRate, vo2Target);
    const overshootBpm = anchorHr - input.lt2Hr;
    const driftedIntoVo2 = !vo2Target && overshootBpm >= 12;
    factors.push({
      ...(isThreshold ? category('threshold_heart_rate') : category('pacing_discipline')),
      points: Math.round(pts),
      maxPoints: max,
      ...(driftedIntoVo2 ? finding('drifted_into_vo2_territory') : band(pts / max, finding('on_target_intensity_control'), finding('grey_zone_intensity_drift'), finding('overreaching_intensity'))),
      description: usePeak
        ? `${anchorHr} bpm peak work HR (${shape?.medianRepSec}s reps are too short to average to target) against a ${input.lt2Hr} bpm LT2 anchor`
        : `${anchorHr} bpm average work HR against a ${input.lt2Hr} bpm LT2 anchor`
    });
  }

  // 3. Form & efficiency: turnover and ground contact hold up under fatigue — 16 pts
  const turnover = turnoverFactor(input, isThreshold ? 5 : 16);
  if (turnover) factors.push(turnover);

  // 4. Set fatigue: did the last work rep match the first? Tolerances scale with
  // the set's work time, and short reps are judged on pace only (HR lag makes
  // their average rise regardless of execution).
  const fatigue = setFatigueDetail(input);
  if (fatigue.paceFadePct != null || (fatigue.gradeHr && fatigue.hrClimbPct != null)) {
    const max = isThreshold ? 10 : 12;
    const pts = curve(max, fatigue.fatiguePct, fatigue.tolerancePct, fatigue.zeroPct);

    const detail: string[] = [];
    if (fatigue.paceFadeSec != null) {
      const deltaSec = Math.round(fatigue.paceFadeSec);
      detail.push(deltaSec >= 0
        ? `last rep ${deltaSec}s/km slower than the first`
        : `last rep ${Math.abs(deltaSec)}s/km faster than the first`);
    }
    if (fatigue.hrClimbBpm != null) {
      const deltaHr = Math.round(fatigue.hrClimbBpm);
      const note = fatigue.gradeHr ? '' : ' (not graded: short reps carry HR lag)';
      detail.push(deltaHr >= 0
        ? `work HR ${deltaHr} bpm higher by the last rep${note}`
        : `work HR ${Math.abs(deltaHr)} bpm lower by the last rep${note}`);
    }

    factors.push({
      ...(category('rep_to_rep_fatigue')),
      points: Math.round(pts),
      maxPoints: max,
      ...(fatigue.fatiguePct <= fatigue.tolerancePct ? finding('held_rep_pace_and_hr_to_the_end') : band(pts / max, finding('held_rep_pace_and_hr_to_the_end'), finding('slight_late_rep_fade'), finding('late_rep_collapse'))),
      description: `${detail.join(' · ')} (across ${fatigue.workReps} reps, ${Math.round(fatigue.tolerancePct)}% drift allowed for the set length)`
    });
  }

  // 5. Session integrity — 10 pts
  // Only walking that interrupted a work rep costs anything: recovery walking
  // between reps and gradient/warm-up walking are legitimate.
  const share = walkSharePct(input.pauseBreakdown);
  if (input.isFailedWorkout || walkAudit || share != null) {
    const max = 10;
    const intrusiveSec = walkAudit ? walkAudit.intrusiveWalkSec : null;
    const intrusiveShare = walkAudit ? (intrusiveSec! / walkAudit.movingSec) * 100 : (share ?? 0);
    // A partly interrupted rep set is never scored as a total write-off.
    let pts = input.isFailedWorkout ? 0 : Math.max(curve(max, intrusiveShare, 0, 15), max * 0.35);
    // A quality session with fewer than two work reps never delivered its structure.
    if (!input.isFailedWorkout && workReps.length < 2) pts = Math.min(pts, max * 0.6);

    const label = input.isFailedWorkout ? finding('aborted_incomplete_quality_workout') : walkAudit && walkAudit.intrusiveWalkSec > 0 ? finding('rep_interrupting_walk_breaks') : band(pts / max, finding('unbroken_session'), finding('minor_break_time'), finding('heavily_interrupted_session'));

    const description = input.isFailedWorkout
      ? 'Target volume was cut short before the planned stimulus was delivered'
      : walkAudit
        ? `${workReps.length} work reps · ${walkAudit.intrusiveWalkSec}s of walking inside work reps (average entry ${walkAudit.avgCorrectiveEntryHr ?? '—'} bpm)`
        : `${workReps.length} work reps · ${(share ?? 0).toFixed(1)}% of moving time in walk breaks`;

    factors.push({ ...(category('workout_completion')), points: Math.round(pts), maxPoints: max, ...label, description });
  }

  return factors;
}

// ---------------------------------------------------------------------------
// Race family: time trials and competitive efforts
// ---------------------------------------------------------------------------
