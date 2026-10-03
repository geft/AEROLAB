import { coachMessage, coachDescription } from '../../domain/coaching/messages.js';
import type { CoachMessage } from '../../../shared/coaching.js';
import type { CoachFindingId } from '../../../shared/coaching.js';
import { category, finding } from '../../domain/coaching/vocabulary.js';
import { RubricFactor, RubricInput, lateCeilingWeight, lateZone2Weight, curve, band, IntensityAudit, HIGH_Z2_BAND_BPM, WalkAudit, walkSharePct } from './evidence.js';
export function gradeAerobic(input: RubricInput, walkAudit: WalkAudit | null, intensity: IntensityAudit | null): RubricFactor[] {
  const factors: RubricFactor[] = [];

  // Only a long session in real heat excuses late-session ceiling creep; heat
  // alone softens late Zone 2 creep.
  const lateWeight = lateCeilingWeight(input.ambientTempC, input.durationMin);
  const lateZone2 = lateZone2Weight(input.ambientTempC);

  // 1. Aerobic intensity discipline — 85 pts
  // Two signals with different severity: time above the ceiling (a real failure)
  // and sustained time in the top of Zone 2 (a soft one — still aerobic, but no
  // longer an easy day in the recovery sense).
  const gradeIntensity = (audit: IntensityAudit): { points: number; label: string; findingId: CoachFindingId; description: CoachMessage } => {
    const effectiveAbove = audit.firstHalfAboveCeilingPct + lateWeight * audit.secondHalfAboveCeilingPct;
    const effectiveHighZ2 = (audit.highZ2FirstHalfPct + lateZone2 * audit.highZ2SecondHalfPct) / 2;
    const abovePoints = curve(ABOVE_CEILING_MAX, effectiveAbove, 5, 40);
    const zone2Points = curve(HIGH_Z2_MAX, effectiveHighZ2, HIGH_Z2_PENALTY_START_PCT, 100);
    const pts = abovePoints + zone2Points;

    const aboveLost = ABOVE_CEILING_MAX - abovePoints;
    const zone2Lost = HIGH_Z2_MAX - zone2Points;

    // Lead the description with whichever signal actually cost the points, so a
    // ceiling-compliant run is never described as a ceiling problem.
    const zone2Text = coachMessage("fragment.in_the_top_of_zone_2_bpm", { p0: audit.highZ2Pct.toFixed(1), p1: audit.lt1Hr - HIGH_Z2_BAND_BPM, p2: audit.lt1Hr });
    const aboveText = coachMessage("fragment.above_the_bpm_lt1_ceiling", { p0: audit.aboveCeilingPct.toFixed(1), p1: audit.lt1Hr });
    const description = aboveLost > 0 && aboveLost >= zone2Lost ? coachMessage("fragment.first_half", { p0: aboveText, p1: audit.firstHalfAboveCeilingPct.toFixed(1), p2: zone2Text }) : coachMessage("fragment.rising_to_in_the_second_half", { p0: zone2Text, p1: aboveText, p2: audit.highZ2SecondHalfPct.toFixed(0) });

    // The label names the signal that actually failed, not a blended ratio.
    const label = aboveLost >= 12 ? finding('extended_above_the_lt1_ceiling') : audit.highZ2Pct < 40 ? finding('clearly_easy') : audit.highZ2Pct < 60 ? finding('normal_easy') : audit.highZ2Pct <= 75 ? finding('upper_easy_aerobic_steady') : finding('potentially_too_close_to_lt1');

    return {
      points: Math.round(pts),
      ...label,
      description
    };
  };

  if (intensity) {
    const graded = gradeIntensity(intensity);
    factors.push({
      ...(category('aerobic_intensity')),
      points: graded.points,
      maxPoints: 85,
      label: graded.label, findingId: graded.findingId,
      ...coachDescription(graded.description)
    });
  } else if (input.steadyHr || input.avgHr) {
    // Coarse fallback when there is no per-second telemetry: an average heart
    // rate cannot show how *long* the ceiling was exceeded, only that it was.
    const hr = input.steadyHr || input.avgHr;
    const pts = curve(85, hr, input.lt1Hr - 8, input.lt1Hr + 12);
    factors.push({
      ...(category('aerobic_intensity')),
      points: Math.round(pts),
      maxPoints: 85,
      ...(band(pts / 85, finding('disciplined_aerobic_ceiling'), finding('normal_easy'), finding('extended_above_the_lt1_ceiling'))),
      ...coachDescription(coachMessage("description.bpm_average_against_a_bpm_lt1_ceiling_average", { p0: hr, p1: input.lt1Hr }))
    });
  }

  // 2. Session integrity — 15 pts. A categorical gate, not a quality judgement:
  // only an aborted session or a session that was mostly walking (and not a
  // planned run/walk rhythm) loses points here.
  const share = walkSharePct(input.pauseBreakdown);
  if (input.isFailedWorkout || walkAudit || share != null) {
    const max = 15;
    const walkPct = walkAudit
      ? (walkAudit.walkSec / walkAudit.movingSec) * 100
      : (share ?? 0);
    let pts: number;
    if (input.isFailedWorkout) {
      pts = 0;
    } else if (walkAudit?.plannedPattern) {
      pts = max; // a structured run/walk session plan is a plan
    } else {
      pts = curve(max, walkPct, 45, 90);
    }

    const label = input.isFailedWorkout ? finding('aborted_incomplete_quality_workout') : pts === max ? finding('unbroken_session') : band(pts / max, finding('substantially_walked_session'), finding('walk_dominated_session'), finding('walk_dominated_session'));

    const description = input.isFailedWorkout ? coachMessage("fragment.target_volume_was_cut_short_before_the_planned") : coachMessage("fragment.of_moving_time_in_walk_breaks_up_to", { p0: walkPct.toFixed(1) });

    factors.push({ ...(category('workout_completion')), points: Math.round(pts), maxPoints: max, ...label, ...coachDescription(description) });
  }

  return factors;
}

// ---------------------------------------------------------------------------
// Quality family: threshold, VO2 max, tempo, strides
// ---------------------------------------------------------------------------

const ABOVE_CEILING_MAX = 60;
const HIGH_Z2_MAX = 25;
const HIGH_Z2_PENALTY_START_PCT = 40;
