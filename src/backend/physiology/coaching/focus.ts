import { coachingInterval } from '../../domain/coaching/telemetry.js';
import { coachMessage, coachJoin, coachCategoryMessage } from '../../domain/coaching/messages.js';
import type { CoachMessage } from '../../../shared/coaching.js';
import { RubricFactor, RubricInput, runFamilyOf, driftTargetFor, coefficientOfVariation, INTERVAL_TYPE, intervalDuration, intervalHr, intervalMaxHr, pacingConsistency, HIGH_Z2_BAND_BPM, intensityAudit, WalkAudit, walkSharePct, setFatigueDetail } from './evidence.js';
import { thresholdZoneShare } from './quality.js';
export function pickFocus(factors: RubricFactor[]): RubricFactor | null {
  let worst: RubricFactor | null = null;
  let worstLoss = 0;
  for (const f of factors) {
    const loss = f.maxPoints - f.points;
    if (loss > worstLoss) {
      worstLoss = loss;
      worst = f;
    }
  }
  if (!worst || (worstLoss < 5 && worstLoss / worst.maxPoints < 0.15)) return null;
  worst.isFocus = true;
  return worst;
}

export function buildFocusAdvice(factor: RubricFactor, input: RubricInput, walkAudit: WalkAudit | null): CoachMessage {
  const lost = factor.maxPoints - factor.points;
  const prefix = coachMessage("fragment.biggest_lever", { p0: coachCategoryMessage(factor.categoryId) });
  const tail = coachMessage("fragment.of_points_lost", { p0: lost, p1: factor.maxPoints });
  const workReps = (input.intervals || []).map(coachingInterval).filter((i) => i.type === INTERVAL_TYPE.work);

  switch (factor.categoryId) {
    case 'threshold_zone_time': {
      const zone = thresholdZoneShare(input);
      return coachMessage("focus.let_heart_rate_settle_near_the_lt2_anchor", { p0: prefix, p1: zone ? coachMessage("fragment.of_observed_work_rep_time_was_within_the", { p0: zone.pct.toFixed(1), p1: zone.lower, p2: zone.upper }) : coachMessage("fragment.threshold_zone_time_could_not_be_measured"), p2: tail });
    }
    case 'threshold_heart_rate':
      return coachMessage("focus.work_rep_heart_rate_missed_the_bpm_lt2", { p0: prefix, p1: input.lt2Hr, p2: tail });
    case 'aerobic_decoupling': {
      const target = driftTargetFor(input.ambientTempC, input.durationMin);
      const targetNote = target.conditionsAdjusted
        ? coachMessage('fragment.condition_adjusted_drift_target', { target: target.fullAtPct })
        : '';
      return coachMessage("focus.cardiac_drift_was_the_largest_single_cost_start", { p0: prefix, p1: (input.decouplingPct ?? 0).toFixed(1), p2: tail, p3: targetNote, p4: input.lt1Hr - 12 });
    }
    case 'pacing_discipline':
      return runFamilyOf(input.runType) === 'quality' ? coachMessage("focus.work_intervals_averaged_bpm_against_a_bpm_lt2", { p0: prefix, p1: Math.round(workReps.reduce((a: number, r) => a + intervalHr(r), 0) / Math.max(1, workReps.filter((r) => intervalHr(r) > 0).length)), p2: input.lt2Hr, p3: tail, p4: input.lt2Hr }) : coachMessage("focus.steady_hr_reached_bpm_against_a_bpm_lt1", { p0: prefix, p1: input.steadyHr, p2: input.lt1Hr, p3: tail, p4: input.lt1Hr - 8 });
    case 'aerobic_intensity': {
      const audit = intensityAudit(input.records, { lt1Hr: input.lt1Hr });
      const above = audit?.aboveCeilingPct ?? 0;
      const zone2 = audit?.highZ2Pct ?? 0;
      const bandLow = input.lt1Hr - HIGH_Z2_BAND_BPM;
      const targetHigh = input.lt1Hr - 10;
      // Advise on whichever signal actually cost the points.
      if (zone2 >= 40 && above < 5) {
        const interpretation = zone2 < 60 ? coachMessage("fragment.normal_easy") : zone2 <= 75 ? coachMessage("fragment.upper_easy_aerobic_steady") : coachMessage("fragment.potentially_too_close_to_lt1_for_a_routine");
        const guidance = zone2 < 60 ? coachMessage("fragment.keep_the_opening_relaxed_and_let_heart_rate") : coachMessage("fragment.for_a_routine_easy_day_ease_the_opening", { p0: targetHigh });
        return coachMessage("focus.you_never_crossed_the_bpm_lt1_ceiling_and", { p0: prefix, p1: input.lt1Hr, p2: zone2.toFixed(1), p3: bandLow, p4: input.lt1Hr, p5: tail, p6: interpretation, p7: guidance });
      }
      return coachMessage("focus.of_your_running_time_sat_above_the_bpm", { p0: prefix, p1: above.toFixed(1), p2: input.lt1Hr, p3: (audit?.firstHalfAboveCeilingPct ?? 0).toFixed(1), p4: tail, p5: bandLow });
    }
    case 'running_turnover':
      return coachMessage("focus.spm_cost_the_most_execution_points_two_weekly", { p0: prefix, p1: input.steadyCadence, p2: tail });
    case 'pacing_consistency': {
      const pacing = pacingConsistency(input.records, input.splits, input.runType);
      const detail = pacing && pacing.source === 'records' ? coachMessage("fragment.your_running_pace_held_within_s_per_kilometre", { p0: Math.round(pacing.stdDevSec), p1: pacing.sampleCount }) : '';
      const trendNote = pacing && pacing.trendSecPerKm >= 6 ? coachMessage("fragment.the_steady_s_km_slowdown_through_the_run", { p0: pacing.trendSecPerKm.toFixed(1) }) : '';
      return coachMessage("focus.running_pace_varied_more_than_it_needed_to", { p0: prefix, p1: tail, p2: detail, p3: trendNote });
    }
    case 'workout_completion': {
      if (input.isFailedWorkout) {
        return coachMessage("focus.the_session_was_aborted_before_the_planned_stimulus", { p0: prefix, p1: tail });
      }
      if (walkAudit && walkAudit.capacityWalkSec > 0) {
        return coachMessage("focus.s_of_mid_run_walking_started_while_heart", { p0: prefix, p1: Math.round(walkAudit.capacityWalkSec), p2: tail });
      }
      if (walkAudit && walkAudit.intrusiveWalkSec > 0) {
        return coachMessage("focus.s_of_walking_started_inside_work_reps_at", { p0: prefix, p1: Math.round(walkAudit.intrusiveWalkSec), p2: walkAudit.avgCorrectiveEntryHr ?? '—', p3: tail });
      }
      const share = walkSharePct(input.pauseBreakdown);
      return coachMessage("focus.of_moving_time_was_spent_in_walk_breaks", { p0: prefix, p1: (share ?? 0).toFixed(1), p2: tail });
    }
    case 'interval_execution':
      return coachMessage("focus.rep_durations_varied_by_fix_the_rep_duration", { p0: prefix, p1: ((coefficientOfVariation(workReps.map(intervalDuration))?.cv ?? 0) * 100).toFixed(1), p2: tail });
    case 'cardiovascular_stimulus': {
      const peakHr = Math.max(0, ...workReps.map(intervalMaxHr), input.activityMaxHr || 0);
      const pct = Math.round((peakHr / (input.maxHeartRate || 1)) * 100);
      return runFamilyOf(input.runType) === 'race' ? coachMessage("focus.the_race_peaked_at_of_hrmax_practise_2", { p0: prefix, p1: pct, p2: tail }) : coachMessage("focus.peak_work_hr_only_reached_of_hrmax_close", { p0: prefix, p1: pct, p2: tail });
    }
    case 'autonomic_recovery':
      return coachMessage("focus.heart_rate_fell_slowly_between_reps_lengthen_recoveries", { p0: prefix, p1: tail });
    case 'race_pacing_execution':
      return coachMessage("focus.opening_pace_discipline_was_the_biggest_cost_run", { p0: prefix, p1: tail });
    case 'race_finish_execution':
      return coachMessage("focus.the_second_half_slowed_noticeably_add_one_long", { p0: prefix, p1: tail });
    case 'rep_to_rep_fatigue': {
      const fatigue = setFatigueDetail(input);
      const parts: CoachMessage[] = [];
      if (fatigue.paceFadeSec != null && Math.abs(fatigue.paceFadeSec) >= 3) {
        parts.push(coachMessage("fragment.the_last_rep_ran_s_km", { p0: Math.abs(Math.round(fatigue.paceFadeSec)), p1: fatigue.paceFadeSec > 0 ? coachMessage("fragment.slower") : coachMessage("fragment.faster") }));
      }
      if (fatigue.hrClimbBpm != null && Math.abs(fatigue.hrClimbBpm) >= 3) {
        parts.push(coachMessage("fragment.work_hr_finished_bpm_than_the_first_rep", { p0: Math.abs(Math.round(fatigue.hrClimbBpm)), p1: fatigue.hrClimbBpm > 0 ? coachMessage("fragment.higher") : coachMessage("fragment.lower") }));
      }
      const finding = parts.length > 0 ? coachMessage("fragment.values_4", { p0: coachJoin(parts, ' and ') }) : '';
      const cause = (fatigue.hrClimbBpm ?? 0) > 0 ? coachMessage("fragment.a_drifting_work_hr_at_held_or_slower") : coachMessage("fragment.that_pattern_points_at_early_rep_overreach_or");
      return coachMessage("focus.the_set_decayed_as_it_went_start_the", { p0: prefix, p1: finding, p2: tail, p3: cause });
    }
    default:
      return coachMessage("focus.this_factor_cost_the_most_points", { p0: prefix, p1: tail });
  }
}
