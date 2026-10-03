import { coachMessage, coachDescription } from '../../domain/coaching/messages.js';
import { category, finding } from '../../domain/coaching/vocabulary.js';
import { RubricFactor, RubricInput, curve, band, coefficientOfVariation, formatPaceText, splitPace, selectRaceSplits, WalkAudit, walkSharePct, turnoverFactor } from './evidence.js';
export function gradeRace(input: RubricInput, walkAudit: WalkAudit | null): RubricFactor[] {
  const factors: RubricFactor[] = [];
  const raceSplits = selectRaceSplits(input.splits, input.intervals);
  const paces = raceSplits.map(splitPace).filter((p: number) => p > 120 && p < 720);
  const paceStats = coefficientOfVariation(paces);
  const firstPace = paces[0] ?? null;
  const secondPace = paces[1] ?? null;
  const surgeSec = firstPace != null && secondPace != null ? secondPace - firstPace : 0;
  const isEarlySurge = surgeSec >= 12;

  // 1. Pacing discipline — 34 pts (heaviest weight: races are won or lost here)
  if (paceStats && paces.length >= 2) {
    const max = 34;
    let pts: number;
    if (isEarlySurge) {
      pts = Math.max(0, max - Math.min(22, surgeSec * 1.2));
    } else if (paceStats.cv <= 0.03) {
      pts = max;
    } else {
      pts = max * Math.max(0.35, 1 - (paceStats.cv - 0.03) / 0.07);
    }
    factors.push({
      ...(category('race_pacing_execution')),
      points: Math.round(pts),
      maxPoints: max,
      ...(isEarlySurge ? finding('aggressive_early_surge_positive_split') : band(pts / max, finding('laser_race_pacing_discipline'), finding('controlled_race_pacing'), finding('volatile_split_pacing'))),
      ...coachDescription(isEarlySurge ? coachMessage("description.km_1_opened_at_then_faded_s_km", { p0: formatPaceText(firstPace!), p1: Math.round(surgeSec), p2: formatPaceText(secondPace!) }) : coachMessage("description.split_variance_s_spread", { p0: (paceStats.cv * 100).toFixed(1), p1: Math.round(paceStats.stdDev) }))
    });
  }

  // 2. Finish strength (second half against first half) — 18 pts
  if (paces.length >= 2) {
    const half = Math.floor(paces.length / 2);
    const firstHalf = paces.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half);
    const secondHalf = paces.slice(paces.length - half).reduce((a, b) => a + b, 0) / Math.max(1, half);
    const fadeSec = secondHalf - firstHalf;
    const max = 18;
    const pts = curve(max, fadeSec, -8, 25);
    factors.push({
      ...(category('race_finish_execution')),
      points: Math.round(pts),
      maxPoints: max,
      ...(band(pts / max, finding('strong_negative_split_finish'), finding('held_form_to_the_line'), finding('late_race_fade'))),
      ...coachDescription(fadeSec >= 0 ? coachMessage("description.s_km_slower_in_the_second_half", { p0: Math.round(fadeSec) }) : coachMessage("description.s_km_faster_in_the_second_half", { p0: Math.abs(Math.round(fadeSec)) }))
    });
  }

  // 3. Cardiovascular utilisation (how much of HRmax the race demanded) — 18 pts
  const peakHr = Math.max(0, input.activityMaxHr || 0);
  if (peakHr > 0 && input.maxHeartRate > 0) {
    const max = 18;
    const pctMax = (peakHr / input.maxHeartRate) * 100;
    const pts = curve(max, pctMax, 92, 78);
    factors.push({
      ...(category('cardiovascular_stimulus')),
      points: Math.round(pts),
      maxPoints: max,
      ...(band(pts / max, finding('full_race_day_heart_rate_utilisation'), finding('partial_race_day_effort'), finding('conservative_heart_rate_ceiling'))),
      ...coachDescription(coachMessage("description.peaked_at_bpm_hrmax", { p0: peakHr, p1: Math.round(pctMax) }))
    });
  }

  // 4. Running turnover — 14 pts
  const turnover = turnoverFactor(input, 14);
  if (turnover) factors.push(turnover);

  // 5. Session integrity — 16 pts
  // In a race, any walk that was not forced by a gradient or the start is a fade signal.
  const share = walkSharePct(input.pauseBreakdown);
  if (input.isFailedWorkout || walkAudit || share != null) {
    const max = 16;
    let pts: number;
    if (input.isFailedWorkout) {
      pts = 0;
    } else if (walkAudit) {
      const fadeSec = walkAudit.intrusiveWalkSec + walkAudit.capacityWalkSec;
      pts = curve(max, (fadeSec / walkAudit.movingSec) * 100, 0, 6);
    } else {
      pts = curve(max, share!, 0, 6);
    }

    const label = input.isFailedWorkout ? finding('aborted_incomplete_quality_workout') : walkAudit && walkAudit.intrusiveWalkSec + walkAudit.capacityWalkSec > 0 ? finding('walk_breaks_inside_the_race_effort') : band(pts / max, finding('unbroken_session'), finding('minor_break_time'), finding('heavily_interrupted_session'));

    const description = input.isFailedWorkout ? coachMessage("fragment.target_volume_was_cut_short_before_the_planned") : walkAudit ? coachMessage("fragment.walk_breaks_of_moving_time_gradient_start_and", { p0: walkAudit.blockCount, p1: (share != null ? share : 0).toFixed(1) }) : coachMessage("fragment.of_moving_time_in_walk_breaks_races_rarely", { p0: (share ?? 0).toFixed(1) });

    factors.push({ ...(category('workout_completion')), points: Math.round(pts), maxPoints: max, ...label, ...coachDescription(description) });
  }

  return factors;
}

// ---------------------------------------------------------------------------
// Biggest lever: the factor that lost the most points
// ---------------------------------------------------------------------------
