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

export function buildFocusAdvice(factor: RubricFactor, input: RubricInput, walkAudit: WalkAudit | null): string {
  const lost = factor.maxPoints - factor.points;
  const prefix = `Biggest Lever — ${factor.category}: `;
  const tail = ` (${lost} of ${factor.maxPoints} points lost)`;
  const workReps = (input.intervals || []).filter((i: any) => i.type === INTERVAL_TYPE.work);

  switch (factor.categoryId) {
    case 'threshold_zone_time': {
      const zone = thresholdZoneShare(input);
      return `${prefix}${zone ? `${zone.pct.toFixed(1)}% of observed work-rep time was within the LT2 band (${zone.lower}-${zone.upper} bpm)` : 'threshold-zone time could not be measured'}${tail}. Let heart rate settle near the LT2 anchor during work reps; use pace only to help hold that effort.`;
    }
    case 'threshold_heart_rate':
      return `${prefix}work-rep heart rate missed the ${input.lt2Hr} bpm LT2 anchor${tail}. Adjust effort to keep the work near threshold rather than chasing a pace target.`;
    case 'aerobic_decoupling': {
      const target = driftTargetFor(input.ambientTempC, input.durationMin);
      const targetNote = target.conditionsAdjusted
        ? ` The target for these conditions is ${target.fullAtPct}% (heat and duration both add drift you cannot pace away), so this is about pacing and fuelling rather than fitness.`
        : '';
      return `${prefix}${(input.decouplingPct ?? 0).toFixed(1)}% cardiac drift was the largest single cost${tail}.${targetNote} Start the opening 2 km 10-15 sec/km slower and add easy volume at or below ${input.lt1Hr - 12} bpm — capillary density, not speed, is the limiter.`;
    }
    case 'pacing_discipline':
      return runFamilyOf(input.runType) === 'quality'
        ? `${prefix}work intervals averaged ${Math.round(workReps.reduce((a: number, r: any) => a + intervalHr(r), 0) / Math.max(1, workReps.filter((r: any) => intervalHr(r) > 0).length))} bpm against a ${input.lt2Hr} bpm LT2 anchor${tail}. Set the watch to alert above ${input.lt2Hr} bpm and hold rep 1 back so rep 3 lands on target.`
        : `${prefix}steady HR reached ${input.steadyHr} bpm against a ${input.lt1Hr} bpm LT1 cap${tail}. Slow the opening 15-20 sec/km and cap the watch at ${input.lt1Hr - 8} bpm so easy days stay easy.`;
    case 'aerobic_intensity': {
      const audit = intensityAudit(input.records, { lt1Hr: input.lt1Hr });
      const above = audit?.aboveCeilingPct ?? 0;
      const zone2 = audit?.highZ2Pct ?? 0;
      const bandLow = input.lt1Hr - HIGH_Z2_BAND_BPM;
      const targetHigh = input.lt1Hr - 10;
      // Advise on whichever signal actually cost the points.
      if (zone2 >= 40 && above < 5) {
        const interpretation = zone2 < 60
          ? 'normal easy'
          : zone2 <= 75
            ? 'upper-easy / aerobic steady'
            : 'potentially too close to LT1 for a routine easy day';
        const guidance = zone2 < 60
          ? 'Keep the opening relaxed and let heart rate rise naturally.'
          : `For a routine easy day, ease the opening kilometres and aim nearer ${targetHigh} bpm.`;
        return `${prefix}you never crossed the ${input.lt1Hr} bpm LT1 ceiling, and ${zone2.toFixed(1)}% of your running time sat in the top of Zone 2 (${bandLow}-${input.lt1Hr} bpm)${tail}. That is ${interpretation}. ${guidance}`;
      }
      return `${prefix}${above.toFixed(1)}% of your running time sat above the ${input.lt1Hr} bpm LT1 ceiling (${(audit?.firstHalfAboveCeilingPct ?? 0).toFixed(1)}% of it in the first half)${tail}. Set a watch alert at ${bandLow} bpm and walk any climb that pushes you over it — for an easy day, keeping the ceiling is the whole session.`;
    }
    case 'running_turnover':
      return `${prefix}${input.steadyCadence} spm cost the most execution points${tail}. Two weekly sets of 4 x 20s strides at 180+ spm raise turnover without adding aerobic load.`;
    case 'pacing_consistency': {
      const pacing = pacingConsistency(input.records, input.splits, input.runType);
      const detail = pacing && pacing.source === 'records'
        ? ` Your running pace held within ±${Math.round(pacing.stdDevSec)}s per kilometre across ${pacing.sampleCount} running km.`
        : '';
      const trendNote = pacing && pacing.trendSecPerKm >= 6
        ? ` The steady ${pacing.trendSecPerKm.toFixed(1)}s/km slowdown through the run points at an opening that was too quick or under-fuelling.`
        : '';
      return `${prefix}running pace varied more than it needed to${tail}.${detail}${trendNote} Lock a pace band before the start and check it every kilometre instead of chasing feel.`;
    }
    case 'workout_completion': {
      if (input.isFailedWorkout) {
        return `${prefix}the session was aborted before the planned stimulus landed${tail}. Re-check sleep, fuel and the previous 48 hours of load before retrying the same session.`;
      }
      if (walkAudit && walkAudit.capacityWalkSec > 0) {
        return `${prefix}${Math.round(walkAudit.capacityWalkSec)}s of mid-run walking started while heart rate was already below your aerobic band${tail}. Worth checking fuelling, sleep and load, or whether the route forces stops.`;
      }
      if (walkAudit && walkAudit.intrusiveWalkSec > 0) {
        return `${prefix}${Math.round(walkAudit.intrusiveWalkSec)}s of walking started inside work reps at an average of ${walkAudit.avgCorrectiveEntryHr ?? '—'} bpm${tail}. Walking was the right call at that heart rate — the fix is upstream: run the first rep 5-8 sec/km easier or pick a route where reps are not interrupted.`;
      }
      const share = walkSharePct(input.pauseBreakdown);
      return `${prefix}${(share ?? 0).toFixed(1)}% of moving time was spent in walk breaks${tail}. Pick a loop with fewer crossings, or place walk breaks at fixed points so the aerobic block stays continuous.`;
    }
    case 'interval_execution':
      return `${prefix}rep durations varied by ${((coefficientOfVariation(workReps.map(intervalDuration))?.cv ?? 0) * 100).toFixed(1)}%${tail}. Fix the rep duration rather than the pace — even reps deliver the intended stimulus.`;
    case 'cardiovascular_stimulus': {
      const peakHr = Math.max(0, ...workReps.map(intervalMaxHr), input.activityMaxHr || 0);
      const pct = Math.round((peakHr / (input.maxHeartRate || 1)) * 100);
      return runFamilyOf(input.runType) === 'race'
        ? `${prefix}the race peaked at ${pct}% of HRmax${tail}. Practise 2 x 8 min at LT2 so race pace feels controlled rather than unknown.`
        : `${prefix}peak work HR only reached ${pct}% of HRmax${tail}. Close the final rep at 90%+ HRmax to load stroke volume instead of stopping at threshold.`;
    }
    case 'autonomic_recovery':
      return `${prefix}heart rate fell slowly between reps${tail}. Lengthen recoveries to 90-120s of easy jogging so every rep starts fresh below LT2.`;
    case 'race_pacing_execution':
      return `${prefix}opening pace discipline was the biggest cost${tail}. Run the first 2 km about 10 sec/km easier than goal pace — a fast opening kilometre spikes lactate early and forces the fade.`;
    case 'race_finish_execution':
      return `${prefix}the second half slowed noticeably${tail}. Add one long run a week with the final 20 minutes at goal race pace to rehearse late-race form.`;
    case 'rep_to_rep_fatigue': {
      const fatigue = setFatigueDetail(input);
      const parts: string[] = [];
      if (fatigue.paceFadeSec != null && Math.abs(fatigue.paceFadeSec) >= 3) {
        parts.push(`the last rep ran ${Math.abs(Math.round(fatigue.paceFadeSec))}s/km ${fatigue.paceFadeSec > 0 ? 'slower' : 'faster'}`);
      }
      if (fatigue.hrClimbBpm != null && Math.abs(fatigue.hrClimbBpm) >= 3) {
        parts.push(`work HR finished ${Math.abs(Math.round(fatigue.hrClimbBpm))} bpm ${fatigue.hrClimbBpm > 0 ? 'higher' : 'lower'} than the first rep`);
      }
      const finding = parts.length > 0 ? ` — ${parts.join(' and ')}` : '';
      const cause = (fatigue.hrClimbBpm ?? 0) > 0
        ? 'A drifting work HR at held or slower pace points at fuelling, heat and recovery between sets rather than at fitness.'
        : 'That pattern points at early-rep overreach or under-fuelling rather than at fitness.';
      return `${prefix}the set decayed as it went${finding}${tail}. ${cause} Start the first rep 5-8 sec/km easier so the final rep lands on target.`;
    }
    default:
      return `${prefix}this factor cost the most points${tail}.`;
  }
}
