import { coachingRecord } from '../../domain/coaching/telemetry.js';
import { observedIntervals } from '../time-series.js';
import { coachingInterval } from '../../domain/coaching/telemetry.js';
import { coachMessage, coachDescription, coachJoin } from '../../domain/coaching/messages.js';
import type { CoachMessage } from '../../../shared/coaching.js';
import { category, finding } from '../../domain/coaching/vocabulary.js';
import { getLt2TrainingBand } from '../zones.js';
import { RubricFactor, RubricInput, curve, band, coefficientOfVariation, INTERVAL_TYPE, intervalDuration, intervalHr, intervalMaxHr, WalkAudit, describeSet, walkSharePct, turnoverFactor, setFatigueDetail, intensityControlPoints } from './evidence.js';
export function thresholdZoneShare(input: RubricInput): { pct: number; seconds: number; lower: number; upper: number } | null {
  const workWindows = (input.intervals || []).map(coachingInterval)
    .filter((rep) => rep.type === INTERVAL_TYPE.work)
    .map((rep) => ({ from: rep.startSeconds, to: (rep.startSeconds) + intervalDuration(rep) }))
    .filter((window: { from: number; to: number }) => Number.isFinite(window.from) && window.to > window.from);
  if (workWindows.length === 0 || !input.records || input.records.length < 10) return null;
  const [lower, upper] = getLt2TrainingBand(input.lt2Hr);
  let observed = 0;
  let inZone = 0;
  const records = input.records.map(coachingRecord);
  for (const interval of observedIntervals(records, record => record.elapsedSeconds)) {
    const hr = interval.a.heartRate;
    if (hr == null || hr <= 40) continue;
    for (const window of workWindows) {
      const seconds = Math.max(0, Math.min(interval.to, window.to) - Math.max(interval.from, window.from));
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
  const isTempo = input.runType === 'tempo';
  const workReps = (input.intervals || []).map(coachingInterval).filter((i) => i.type === INTERVAL_TYPE.work);

  if (isThreshold) {
    const zone = thresholdZoneShare(input);
    if (zone) {
      const max = 50;
      const pts = curve(max, zone.pct, 70, 10);
      factors.push({
        ...(category('threshold_zone_time')), points: Math.round(pts), maxPoints: max,
        ...(band(pts / max, finding('sustained_threshold_heart_rate'), finding('partial_threshold_exposure'), finding('little_threshold_exposure'))),
        ...coachDescription(coachMessage("description.m_s_within_the_lt2_band_bpm_of", { p0: Math.floor(zone.seconds / 60), p1: String(zone.seconds % 60).padStart(2, '0'), p2: zone.lower, p3: zone.upper, p4: zone.pct.toFixed(1) }))
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
      ...coachDescription(coachMessage("description.duration_variance_across_reps_s_spread", { p0: cvPct.toFixed(1), p1: workReps.length, p2: Math.round(durationStats.stdDev) }))
    });
  }

  // 2. Cardiovascular stimulus (peak work HR as a share of HRmax) — 20 pts
  const peakHr = Math.max(0, ...workReps.map(intervalMaxHr), input.activityMaxHr || 0);
  if (!isThreshold && !isTempo && peakHr > 0 && input.maxHeartRate > 0) {
    const max = 20;
    const pctMax = (peakHr / input.maxHeartRate) * 100;
    const pts = curve(max, pctMax, 90, 75);
    factors.push({
      ...(category('cardiovascular_stimulus')),
      points: Math.round(pts),
      maxPoints: max,
      ...(band(pts / max, finding('target_vo2_stimulus_achieved'), finding('partial_cardiovascular_stimulus'), finding('insufficient_cardiovascular_stimulus'))),
      ...coachDescription(coachMessage("description.peaked_at_bpm_hrmax", { p0: peakHr, p1: Math.round(pctMax) }))
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
  if (anchorHr > 0 && !isTempo) {
    const max = isThreshold ? 15 : 20;
    const pts = intensityControlPoints(max, anchorHr, input.lt2Hr, input.maxHeartRate, vo2Target);
    const overshootBpm = anchorHr - input.lt2Hr;
    const driftedIntoVo2 = !vo2Target && overshootBpm >= 12;
    factors.push({
      ...(isThreshold ? category('threshold_heart_rate') : category('pacing_discipline')),
      points: Math.round(pts),
      maxPoints: max,
      ...(driftedIntoVo2 ? finding('drifted_into_vo2_territory') : band(pts / max, finding('on_target_intensity_control'), finding('grey_zone_intensity_drift'), finding('overreaching_intensity'))),
      ...coachDescription(usePeak ? coachMessage("description.bpm_peak_work_hr_s_reps_are_too", { p0: anchorHr, p1: shape?.medianRepSec, p2: input.lt2Hr }) : coachMessage("description.bpm_average_work_hr_against_a_bpm_lt2", { p0: anchorHr, p1: input.lt2Hr }))
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

    const detail: CoachMessage[] = [];
    if (fatigue.paceFadeSec != null) {
      const deltaSec = Math.round(fatigue.paceFadeSec);
      detail.push(deltaSec >= 0 ? coachMessage("fragment.last_rep_s_km_slower_than_the_first", { p0: deltaSec }) : coachMessage("fragment.last_rep_s_km_faster_than_the_first", { p0: Math.abs(deltaSec) }));
    }
    if (fatigue.hrClimbBpm != null) {
      const deltaHr = Math.round(fatigue.hrClimbBpm);
      const note = fatigue.gradeHr ? '' : coachMessage("fragment.not_graded_short_reps_carry_hr_lag");
      detail.push(deltaHr >= 0 ? coachMessage("fragment.work_hr_bpm_higher_by_the_last_rep", { p0: deltaHr, p1: note }) : coachMessage("fragment.work_hr_bpm_lower_by_the_last_rep", { p0: Math.abs(deltaHr), p1: note }));
    }

    factors.push({
      ...(category('rep_to_rep_fatigue')),
      points: Math.round(pts),
      maxPoints: max,
      ...(fatigue.fatiguePct <= fatigue.tolerancePct ? finding('held_rep_pace_and_hr_to_the_end') : band(pts / max, finding('held_rep_pace_and_hr_to_the_end'), finding('slight_late_rep_fade'), finding('late_rep_collapse'))),
      ...coachDescription(coachMessage("description.across_reps_drift_allowed_for_the_set_length", { p0: coachJoin(detail, ' · '), p1: fatigue.workReps, p2: Math.round(fatigue.tolerancePct) }))
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
    if (!input.isFailedWorkout && !isTempo && workReps.length < 2) pts = Math.min(pts, max * 0.6);

    const label = input.isFailedWorkout ? finding('aborted_incomplete_quality_workout') : walkAudit && walkAudit.intrusiveWalkSec > 0 ? finding('rep_interrupting_walk_breaks') : band(pts / max, finding('unbroken_session'), finding('minor_break_time'), finding('heavily_interrupted_session'));

    const description = input.isFailedWorkout ? coachMessage("fragment.target_volume_was_cut_short_before_the_planned") : walkAudit ? coachMessage("fragment.work_reps_s_of_walking_inside_work_reps", { p0: workReps.length, p1: walkAudit.intrusiveWalkSec, p2: walkAudit.avgCorrectiveEntryHr ?? '—' }) : coachMessage("fragment.work_reps_of_moving_time_in_walk_breaks", { p0: workReps.length, p1: (share ?? 0).toFixed(1) });

    factors.push({ ...(category('workout_completion')), points: Math.round(pts), maxPoints: max, ...label, ...coachDescription(description) });
  }

  return factors;
}

// ---------------------------------------------------------------------------
// Race family: time trials and competitive efforts
// ---------------------------------------------------------------------------
