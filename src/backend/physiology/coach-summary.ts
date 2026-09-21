import type { SessionVerdict } from '../../shared/session-verdict.js';
import { getAthleteHeartRateProfile } from './athlete-profile.js';
import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { PauseBreakdown, extractSteadyStateMetrics } from './economy.js';
import { ZoneDistribution } from './zones.js';
import { RubricFactor, gradeRun, driftTargetFor, describeSet, betweenRepRecoveries, intervalDrop, intervalDuration, intervalHr, intervalMaxHr, selectRaceSplits, formatPaceText } from './coach-rubric.js';
import { CoachContext, buildContextInsights, loadCoachHistoryContext } from './coach-history.js';
import { createInsightLog, type CoachInsightTone } from './coach-insight.js';

/** One graded line of the weighted execution rubric. */
export type ScoreFactor = RubricFactor;

export interface CoachSummary {
  verdict: SessionVerdict;
  headline: string;
  effectivenessScore: number; // 0 - 100
  rating5: number; // 1.0 - 5.0 rating scale
  stars: number; // 1 - 5 stars
  keyInsights: string[];
  /**
   * How each insight in `keyInsights` should be read, index-for-index:
   * 'positive' (strength), 'caution' (watch it), 'negative' (fix it) or
   * 'neutral' (context). Stored beside the sentences so the list can be
   * colour-coded without the client guessing from the wording.
   */
  insightTones: CoachInsightTone[];
  recommendation: string;
  scoreBreakdown: ScoreFactor[];
  // The single factor that lost the most points, phrased as the next action.
  focusAdvice?: string | null;
  /** How much of the 100-point rubric was measurable for this session. */
  rubricCoveragePct?: number;
  /** Which weighted rubric was applied: aerobic, quality or race. */
  rubricFamily?: string;
  /** Walk-break classification when per-second telemetry was available. */
  walkAudit?: any | null;
  /** Personal-baseline comparison against the athlete's own recent history. */
  context?: CoachContext | null;
  updatedAt?: string;
  steadyPaceSecKm?: number | null;
  steadyHeartRate?: number | null;
  steadyCadence?: number | null;
  steadyStanceTime?: number | null;
  pauseBreakdown?: PauseBreakdown | null;
}

export function generateCoachSummary(params: {
  runType: string;
  sessionTags?: string[];
  distanceKm: number;
  durationMin: number;
  avgPaceSecKm: number;
  avgHr: number;
  maxHr: number;
  cadence: number;
  decouplingPct: number | null;
  efficiencyFactor: number | null;
  avgTemp: number | null;
  groundContactTime: number | null;
  elevationGainM?: number | null;
  zoneDist?: ZoneDistribution;
  isFailedWorkout?: boolean;
  // Steady state values (isolated from traffic pauses and walk breaks)
  steadyPaceSecKm?: number | null;
  steadyHr?: number | null;
  steadyCadence?: number | null;
  steadyStanceTime?: number | null;
  pauseBreakdown?: PauseBreakdown | null;
  // Athlete profile thresholds
  lt1Hr?: number | null;
  lt2Hr?: number | null;
  maxHeartRate?: number | null;
  restingHr?: number | null;
  // External microclimate weather telemetry
  weatherTempC?: number | null;
  weatherHumidityPct?: number | null;
  weatherApparentTempC?: number | null;
  weatherCondition?: string | null;
  // Interval reps telemetry (for quality threshold / VO2 sessions)
  intervals?: any[] | null;
  splits?: any[] | null;
  /** Per-second telemetry: lets the rubric judge *why* walk breaks happened. */
  records?: any[] | null;
  /** Personal-baseline comparison built from the athlete's own prior runs. */
  history?: CoachContext | null;
}): CoachSummary {
  const {
    runType,
    avgPaceSecKm,
    avgHr,
    cadence,
    decouplingPct,
    avgTemp,
    groundContactTime,
    steadyPaceSecKm,
    steadyHr,
    steadyCadence,
    steadyStanceTime,
    pauseBreakdown
  } = params;

  // Use steady-state values when available to avoid pause/stop distortion
  const effectiveCadence = steadyCadence || cadence;
  const effectiveHr = steadyHr || avgHr;
  const effectivePaceSecKm = steadyPaceSecKm || avgPaceSecKm;
  const effectiveGct = steadyStanceTime || groundContactTime;

  const hrProfile = resolveHeartRateProfile({ maxHr: params.maxHeartRate, restingHr: params.restingHr, lt1Hr: params.lt1Hr, lt2Hr: params.lt2Hr });
  const { lt1Hr: lt1 } = hrProfile;

  const hasMarathonPaceBlocks = runType === 'marathon_pace' ||
    (runType === 'long_run' && (params.sessionTags || []).includes('Marathon Pace'));
  const insights = createInsightLog();

  // Failed workout alert
  if (params.isFailedWorkout) {
    insights.add('negative', '⚠️ Incomplete / Aborted Quality Effort: Target interval volume was cut short or pace collapsed. Re-evaluate fatigue levels before your next hard effort.');
  }

  // 1. Explicit Traffic & Walk Break Isolation Insight
  if (pauseBreakdown && (pauseBreakdown.stopDurationSeconds > 0 || pauseBreakdown.walkDurationSeconds > 0)) {
    const parts: string[] = [];
    if (pauseBreakdown.stopCount > 0 || pauseBreakdown.stopDurationSeconds > 0) {
      const stopMins = Math.floor(pauseBreakdown.stopDurationSeconds / 60);
      const stopSecs = pauseBreakdown.stopDurationSeconds % 60;
      const stopTimeStr = stopMins > 0 ? `${stopMins}m ${stopSecs}s` : `${stopSecs}s`;
      parts.push(`${pauseBreakdown.stopCount} stationary/traffic stop${pauseBreakdown.stopCount === 1 ? '' : 's'} (${stopTimeStr} idle)`);
    }
    if (pauseBreakdown.walkCount > 0 || pauseBreakdown.walkDurationSeconds > 0) {
      const walkMins = Math.floor(pauseBreakdown.walkDurationSeconds / 60);
      const walkSecs = pauseBreakdown.walkDurationSeconds % 60;
      const walkTimeStr = walkMins > 0 ? `${walkMins}m ${walkSecs}s` : `${walkSecs}s`;
      parts.push(`${pauseBreakdown.walkCount} walk break${pauseBreakdown.walkCount === 1 ? '' : 's'} (${walkTimeStr}, ${Math.round(pauseBreakdown.walkDistanceMeters)}m)`);
    }

    const paceMin = Math.floor(effectivePaceSecKm / 60);
    const paceSec = Math.round(effectivePaceSecKm % 60);
    const cleanPaceStr = `${paceMin}:${String(paceSec).padStart(2, '0')}/km`;

    insights.add(
      'neutral',
      `Traffic & Walk Break Isolation: Removed ${parts.join(' and ')} from steady-state analysis. Your true running pace averaged ${cleanPaceStr} at ${effectiveHr} bpm (${effectiveCadence} spm), preventing pause distortion.`
    );
  }

  // Aerobic decoupling / Cardiac Drift insight (applies ONLY to steady continuous aerobic runs)
  const isSteadyAerobic = runType === 'easy_base' || runType === 'long_run' || runType === 'recovery' || runType === 'accidental_tempo';
  const driftTarget = driftTargetFor(avgTemp ?? null, params.durationMin ?? null);
  if (isSteadyAerobic && decouplingPct !== null) {
    const conditionNote = driftTarget.conditionsAdjusted
      ? `${avgTemp ? ` ${avgTemp}°C` : ' these conditions'} over ${Math.round(params.durationMin)} min`
      : '';
    if (decouplingPct <= driftTarget.fullAtPct) {
      insights.add('positive', `Superb cardiovascular stability with only ${decouplingPct.toFixed(1)}% drift, at or inside the ${driftTarget.fullAtPct}% target that${conditionNote || ' these conditions'} predict. Your aerobic capillary base is working efficiently with zero late-run cardiac fatigue.`);
    } else if (decouplingPct < driftTarget.fullAtPct + 3.0) {
      insights.add('positive', `Solid aerobic discipline. Decoupling was ${decouplingPct.toFixed(1)}%, just above the ${driftTarget.fullAtPct}% working target for${conditionNote || ' these conditions'} but well within the sub-LT1 gold standard threshold (<5%).`);
    } else {
      insights.add('caution', `Noticeable cardiac drift detected (${decouplingPct.toFixed(1)}% against a ${driftTarget.fullAtPct}% target for${conditionNote || ' these conditions'}). Likely due to thermal strain${avgTemp ? ` (${avgTemp}°C)` : ''}, dehydration, or pacing slightly ahead of current aerobic capacity.`);
    }
  }

  // Structured Interval Execution Quality (for VO2 Max & Threshold quality sessions)
  // Pace-free: duration consistency (structure) + peak-HR attainment (profile-relative).
  if ((runType === 'intervals_vo2' || runType === 'threshold_lt2') && params.intervals && params.intervals.length > 0) {
    const workReps = params.intervals.filter((i: any) => i.type === 'work');
    if (workReps.length >= 2) {
      const durations = workReps
        .map((r: any) => r.duration_seconds ?? r.durationSeconds)
        .filter((d: number) => d > 0);
      if (durations.length >= 2) {
        const meanDur = durations.reduce((a: number, b: number) => a + b, 0) / durations.length;
        const variance = durations.reduce((a: number, b: number) => a + Math.pow(b - meanDur, 2), 0) / durations.length;
        const stdDev = Math.sqrt(variance);
        const cv = meanDur > 0 ? stdDev / meanDur : 0;

        if (cv <= 0.08) {
          insights.add(
            'positive',
            `Exceptional Rep Consistency: Executed ${workReps.length} work reps with laser precision (${(cv * 100).toFixed(1)}% duration variance, ±${Math.round(stdDev)}s spread). Zero early overshoot or late-rep collapse.`
          );
        } else if (cv <= 0.15) {
          insights.add(
            'positive',
            `Disciplined Interval Structure: Held ${workReps.length} work reps consistently (${(cv * 100).toFixed(1)}% duration variance).`
          );
        } else if (cv > 0.25) {
          insights.add(
            'caution',
            `Rep Variance Warning: High duration variance across reps (${(cv * 100).toFixed(1)}%). Focus on even rep durations to keep the stimulus consistent across the entire set.`
          );
        }
      }

      // Check Peak HR reached (true cardiovascular stimulus for VO2 Max)
      const maxWorkHr = Math.max(...workReps.map((r: any) => r.max_heart_rate ?? r.maxHeartRate ?? 0));
      const maxProfileHr = hrProfile.maxHr;
      if (runType === 'intervals_vo2' && maxWorkHr > 0) {
        const pctMax = (maxWorkHr / maxProfileHr) * 100;
        if (pctMax >= 88) {
          insights.add(
            'positive',
            `Target VO2 Stimulus Achieved: Heart rate peaked at ${maxWorkHr} bpm (${pctMax.toFixed(0)}% HRmax), successfully stimulating maximal oxygen uptake and cardiac stroke volume adaptations.`
          );
        }
      }

      // Work intensity: name the session's anchor and flag drift into another zone.
      {
        const shape = describeSet(params.intervals);
        const hrs = workReps.map(intervalHr).filter((h: number) => h > 0);
        const peakHr = Math.max(0, ...workReps.map(intervalMaxHr));
        const anchorHr = shape?.shortReps && peakHr > 0
          ? peakHr
          : (hrs.length > 0 ? Math.round(hrs.reduce((a: number, b: number) => a + b, 0) / hrs.length) : 0);
        const overshoot = anchorHr - hrProfile.lt2Hr;
        if (anchorHr > 0 && runType !== 'intervals_vo2' && overshoot >= 12) {
          insights.add(
            'negative',
            `Session Drift: work reps ${shape?.shortReps ? 'peaked at' : 'averaged'} ${anchorHr} bpm against your ${hrProfile.lt2Hr} bpm LT2 anchor — ${overshoot} bpm above it, so this ran as a VO2 session rather than threshold. That is a different stimulus, not a better one: either log it as intervals_vo2 or ease the pace so the reps stay on the threshold anchor.`
          );
        } else if (anchorHr > 0 && runType !== 'intervals_vo2' && overshoot <= -18) {
          insights.add(
            'caution',
            `Session Drift: work reps averaged ${anchorHr} bpm, ${Math.abs(overshoot)} bpm below your ${hrProfile.lt2Hr} bpm LT2 anchor, so the threshold stimulus was not reached. Nudge the pace up or shorten the recoveries.`
          );
        }
      }

      // Set profile: state the structure being judged, so the grade is readable
      // whether it was 3 x 15 min or 12 x 1 min.
      const shape = describeSet(params.intervals);
      if (shape) {
        const fmtDuration = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s` : `${sec}s`);
        const recoveryNote = shape.recoverySec != null ? ` with ${fmtDuration(shape.recoverySec)} recoveries` : '';
        insights.add(
          'neutral',
          `Set Profile: ${shape.repCount} x ${fmtDuration(shape.medianRepSec)} work${recoveryNote} — ${fmtDuration(shape.totalWorkSec)} of total work time, graded against the tolerances that set length allows.`
        );
      }

      // Recovery structure: reported, never scored — shortening recoveries is a
      // deliberate way to keep heart rate near threshold and extend time in zone.
      // betweenRepRecoveries owns the window, so warm-up stride jog-recoveries
      // cannot be averaged in with the set's real recoveries.
      const allIntervals = params.intervals;
      const recoveries = betweenRepRecoveries(allIntervals).filter((i: any) =>
        intervalDrop(i) > 0 && intervalDuration(i) >= 30
      );
      if (recoveries.length > 0) {
        const drops = recoveries.map((r: any) => intervalDrop(r));
        const avgDrop = Math.round(drops.reduce((a: number, b: number) => a + b, 0) / drops.length);
        const avgRecoverySec = Math.round(recoveries.reduce((a: number, r: any) => a + intervalDuration(r), 0) / recoveries.length);
        const bpmPerMin = Math.round(avgDrop / (avgRecoverySec / 60));
        if (avgRecoverySec <= 120) {
          insights.add(
            'neutral',
            `Recovery Intent: ${recoveries.length} recoveries averaged ${avgRecoverySec}s, dropping heart rate ${avgDrop} bpm (${bpmPerMin} bpm/min). Short recoveries deliberately keep heart rate near threshold so more of the set counts as time-in-zone, so the drop size is not graded here — whether the reps held pace and heart rate is.`
          );
        } else if (bpmPerMin < 8) {
          insights.add(
            'caution',
            `Recovery Rate: ${recoveries.length} recoveries averaged ${avgRecoverySec}s with a ${avgDrop} bpm drop (${bpmPerMin} bpm/min), which is slow even for recoveries of that length. Worth checking fuelling and whether the work reps are exceeding the intended intensity.`
          );
        } else {
          insights.add(
            'positive',
            `Recovery Rate: ${recoveries.length} recoveries averaged ${avgRecoverySec}s with a ${avgDrop} bpm drop (${bpmPerMin} bpm/min), a healthy decay for that recovery length.`
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Race / Time Trial Execution: Pacing Discipline & Split Consistency
  // ---------------------------------------------------------------------------
  if (runType === 'race' && params.splits && params.splits.length >= 2) {
    const raceSplits = selectRaceSplits(params.splits, params.intervals);

    if (raceSplits.length >= 2) {
      const paces = raceSplits.map((s: any) => s.avg_pace_sec_km || s.avgPaceSecKm);
      const firstPace = paces[0];
      const secondPace = paces[1];
      const avgPace = paces.reduce((a: number, b: number) => a + b, 0) / paces.length;

      const variance = paces.reduce((a: number, b: number) => a + Math.pow(b - avgPace, 2), 0) / paces.length;
      const stdDev = Math.sqrt(variance);
      const cv = avgPace > 0 ? stdDev / avgPace : 0;

      const fmt = formatPaceText;

      const earlySurgeSec = secondPace - firstPace;
      const isEarlySurge = earlySurgeSec >= 12;

      if (isEarlySurge) {
        insights.add(
          'negative',
          `Race Pacing Alert: Opened too fast in the first kilometer (${fmt(firstPace)} vs ${fmt(secondPace)} in Km 2, a +${Math.round(earlySurgeSec)}s/km drop). An over-aggressive opening km spikes blood lactate early and forces premature deceleration.`
        );
      } else if (cv <= 0.03) {
        insights.add(
          'positive',
          `Masterful Race Pacing: Maintained exceptional pacing consistency across race splits (${(cv * 100).toFixed(1)}% variance, ±${Math.round(stdDev)}s spread).`
        );
      }

      if (cv > 0.05 && !isEarlySurge) {
        insights.add(
          'caution',
          `Erratic Race Pacing: Split paces fluctuated significantly (±${Math.round(stdDev)}s variance). Target an even or slight negative split to maximize endurance efficiency.`
        );
      }
    }
  }

  // Cadence insight (evaluated on true steady-state running)
  if (effectiveCadence >= 172 && effectiveCadence <= 186) {
    insights.add('positive', `Cadence was right in the sweet spot (${effectiveCadence} spm), minimizing vertical braking forces and maximizing elastic recoil.`);
  } else if (effectiveCadence > 186) {
    insights.add('positive', `High turnover (${effectiveCadence} spm) maintained during steady running, promoting quick foot turnover.`);
  } else if (effectiveCadence > 0 && effectiveCadence < 165) {
    insights.add('caution', `Steady running cadence averaged ${effectiveCadence} spm. Increasing turnover toward 170-180 spm will decrease ground contact time and reduce joint impact.`);
  }

  // Running dynamics insight
  if (effectiveGct && effectiveGct < 260) {
    insights.add('positive', `Swift ground reaction: ${Math.round(effectiveGct)} ms stance time demonstrates crisp ground clearance and leg spring stiffness.`);
  }

  // Heat & Environment
  if (params.weatherTempC !== undefined && params.weatherTempC !== null) {
    const condStr = params.weatherCondition ? ` (${params.weatherCondition})` : '';
    const humidStr = params.weatherHumidityPct ? ` with ${params.weatherHumidityPct}% humidity` : '';
    const feelsLikeStr = params.weatherApparentTempC ? ` (feels like ${params.weatherApparentTempC}°C)` : '';
    const watchStr = avgTemp ? ` [Garmin watch sensor: ${avgTemp}°C]` : '';
    insights.add('neutral', `Microclimate Weather: ${params.weatherTempC}°C ambient${condStr}${humidStr}${feelsLikeStr}${watchStr}. ${
      params.weatherHumidityPct && params.weatherHumidityPct >= 80
        ? 'High tropical humidity restricts evaporative cooling and directly explains elevated cardiac drift.'
        : 'Microclimate weather verified from local meteorological reanalysis.'
    }`);
  } else if (avgTemp && avgTemp >= 30) {
    insights.add('neutral', `Executed in hot conditions (${avgTemp}°C). In high heat, heart rate naturally drifts 4-8 bpm higher; effective aerobic pacing was maintained despite the thermal burden.`);
  }

  // Elevation ramp walk check
  if (params.elevationGainM && params.elevationGainM >= 15) {
    insights.add('neutral', `Elevation & Ramps: Gained +${Math.round(params.elevationGainM)}m ascent. Uphill grade segments and ramp walks were isolated to keep your flat-ground running economy unskewed.`);
  }

  // Pacing discipline check for easy runs (detect accidental tempo using steady running HR & personalized LT1)
  const hrFloor = params.restingHr ? params.restingHr + 15 : 120;
  const isAccidentalTempo = (runType === 'easy_base' || runType === 'accidental_tempo' || runType === 'recovery')
    && effectiveHr > hrFloor
    && (effectiveHr >= lt1 || (decouplingPct !== null && decouplingPct >= 6.5));

  if (isAccidentalTempo) {
    insights.add('negative', `Pacing Alert: Heart rate drifted notably higher than pure Zone 2 (${effectiveHr} bpm avg). This functioned as an unintentional 'grey-zone' tempo effort rather than a low-stress aerobic recovery session.`);
  }

  // ---------------------------------------------------------------------------
  // Weighted execution rubric (replaces the old flat 85-point baseline)
  // ---------------------------------------------------------------------------
  const rubric = gradeRun({
    runType: hasMarathonPaceBlocks ? 'marathon_pace' : runType,
    isFailedWorkout: !!params.isFailedWorkout,
    steadyHr: effectiveHr || null,
    avgHr,
    steadyCadence: effectiveCadence || null,
    steadyStanceTime: effectiveGct || null,
    decouplingPct,
    isAccidentalTempo,
    lt1Hr: lt1,
    lt2Hr: hrProfile.lt2Hr,
    maxHeartRate: hrProfile.maxHr,
    activityMaxHr: params.maxHr || null,
    ambientTempC: avgTemp ?? null,
    durationMin: params.durationMin ?? null,
    pauseBreakdown,
    records: params.records ?? null,
    intervals: params.intervals,
    splits: params.splits
  });

  const finalScore = rubric.score;
  // 3-tier star system: 1 = Bronze (<70), 2 = Silver (70-84), 3 = Gold (>=85)
  const stars = finalScore >= 85 ? 3 : finalScore >= 70 ? 2 : 1;
  const rating5 = Number(((finalScore / 20)).toFixed(1));

  // Walk breaks are coaching information, not a moral judgement: explain what
  // they were for, and only flag the ones that actually cost the session.
  const walkAudit = rubric.walkAudit;
  if (walkAudit && walkAudit.blockCount > 0) {
    const walkPct = ((walkAudit.walkSec / walkAudit.movingSec) * 100).toFixed(1);
    const deliberateSec = walkAudit.deliberateWalkSec + walkAudit.preventiveWalkSec;
    if (walkAudit.recoveryWalkSec >= 20) {
      insights.add(
        'neutral',
        `Interval-Break Walking: ${walkAudit.recoveryWalkSec}s of walking across ${walkAudit.recoveryBlockCount} breaks fell inside your prescribed recovery windows. That is the session design, so it is not scored as lost work.`
      );
    }
    if (walkAudit.artifactBlockCount >= 2) {
      insights.add(
        'neutral',
        `Turnaround Dips: ${walkAudit.artifactBlockCount} brief cadence dips (up to ${walkAudit.artifactWalkSec}s total, barely any ground covered) were ignored as loop turnarounds rather than counted as walk breaks.`
      );
    }
    if (!hasMarathonPaceBlocks && deliberateSec >= 30 && walkAudit.intrusiveWalkSec === 0 && walkAudit.capacityWalkSec === 0 && walkAudit.recoveryWalkSec === 0) {
      const entryHr = walkAudit.avgPreventiveEntryHr;
      const peakNote = walkAudit.maxEntryHr ? `, peaking at ${walkAudit.maxEntryHr} bpm` : '';
      insights.add(
        'positive',
        `Walk-Break Strategy: ${walkAudit.blockCount} walk breaks (${walkPct}% of moving time${entryHr ? `, average entry ${entryHr} bpm` : ''}) held heart rate under your ${lt1} bpm LT1 ceiling${peakNote}. That is ceiling discipline, not lost training time.`
      );
    }
    if (!hasMarathonPaceBlocks && walkAudit.intrusiveWalkSec >= 20) {
      insights.add(
        'negative',
        `Work-Rep Interruption: ${walkAudit.intrusiveWalkSec}s of walking began inside work reps at an average of ${walkAudit.avgCorrectiveEntryHr ?? '—'} bpm (at or above LT1). Walking was the right call at that heart rate, so fix it upstream by easing the opening rep or choosing a route where reps are not interrupted.`
      );
    }
    if (!hasMarathonPaceBlocks && walkAudit.capacityWalkSec >= 30) {
      insights.add(
        'negative',
        `Unplanned Walking: ${walkAudit.capacityWalkSec}s of mid-run walking started at about ${walkAudit.avgCapacityEntryHr ?? '—'} bpm — already below your aerobic band and not on a gradient. Worth checking fuelling, sleep and load, or simply whether the route forces stops.`
      );
    }
  }

  // Pacing stability is measured on the kilometres actually run, so city
  // navigation (lights, junctions, turns) is reported rather than charged.
  const pacing = rubric.pacing;
  if (pacing && pacing.source === 'records' && pacing.sampleCount >= 5 && pacing.affectedCount >= 1) {
    const trendNote = Math.abs(pacing.trendSecPerKm) >= 2
      ? `, ${pacing.trendSecPerKm > 0 ? 'with a steady ' + pacing.trendSecPerKm.toFixed(1) + 's/km slowdown through the run' : 'progressively ' + Math.abs(pacing.trendSecPerKm).toFixed(1) + 's/km faster through the run'}`
      : '';
    // A fading second half is worth flagging; a negative split is worth noting.
    const trendTone: CoachInsightTone = Math.abs(pacing.trendSecPerKm) < 2
      ? 'neutral'
      : (pacing.trendSecPerKm > 0 ? 'caution' : 'positive');
    insights.add(
      trendTone,
      `Pacing Discipline: your running pace held within ±${Math.round(pacing.stdDevSec)}s per kilometre across ${pacing.sampleCount} running km${trendNote}. The ${pacing.affectedCount} km that contained stops, junctions or walk breaks were measured on running time only, so navigating the city did not count against you.`
    );
  }

  // Aerobic intensity: the one thing an easy run is graded on.
  const intensity = rubric.intensity;
  if (intensity && rubric.family === 'aerobic') {
    const above = intensity.aboveCeilingPct;
    const zone2 = intensity.highZ2Pct;
    const band = `${intensity.lt1Hr - 7}-${intensity.lt1Hr}`;
    if (above <= 5 && zone2 <= 25) {
      insights.add(
        'positive',
        `Aerobic Intensity Discipline: only ${above.toFixed(1)}% of your running time sat above the ${intensity.lt1Hr} bpm LT1 ceiling (${intensity.firstHalfAboveCeilingPct.toFixed(1)}% of it in the first half), so this stayed an aerobic session throughout. That control — not pace — is what an easy day is for.`
      );
    } else if (above <= 5) {
      insights.add(
        'caution',
        `Zone 2 Ceiling Held, High-Zone-2 Creep: you never crossed the ${intensity.lt1Hr} bpm LT1 ceiling, but ${zone2.toFixed(1)}% of your running time sat in the top of Zone 2 (${band} bpm), rising to ${intensity.highZ2SecondHalfPct.toFixed(0)}% in the second half. It is still aerobic, and in ${Math.round(params.avgTemp ?? 0)}°C much of the late creep is heat rather than pace, but sitting just under the ceiling costs recovery — ease the opening kilometres so the whole run sits nearer ${intensity.lt1Hr - 10} bpm.`
      );
    } else if (above <= 20) {
      insights.add(
        'caution',
        `Grey-Zone Creep: ${above.toFixed(1)}% of running time was above your ${intensity.lt1Hr} bpm LT1 ceiling (${intensity.firstHalfAboveCeilingPct.toFixed(1)}% of it in the first half). Small doses cost little, but the easy-day benefit comes from staying under it.`
      );
    } else {
      insights.add(
        'negative',
        `Over-Intensity: ${above.toFixed(1)}% of your running time sat above the ${intensity.lt1Hr} bpm LT1 ceiling, with ${intensity.firstHalfAboveCeilingPct.toFixed(1)}% of it in the first half. That is a tempo effort wearing an easy-day label, so it costs recovery without adding aerobic volume.`
      );
    }
  }

  // Personal baseline: only meaningful when the athlete has comparable history.
  const contextInsights = buildContextInsights(params.history);
  insights.addAll(contextInsights);

  let headline = 'Strong Aerobic Adaptation Session';
  let recommendation = 'Prioritize light hydration and low-impact movement before your next hard effort.';

  if (params.isFailedWorkout) {
    headline = 'Incomplete / Aborted Quality Session';
    recommendation = 'Assess underlying fatigue, heat stress, or nutrition. Take a recovery day before attempting another quality stimulus.';
  } else if (runType === 'race') {
    headline = finalScore >= 85
      ? 'All-Out Benchmark / Masterful Race Execution'
      : 'All-Out Benchmark Effort (Erratic Pacing)';
    recommendation = finalScore >= 85
      ? 'Exceptional competitive effort. Prioritize complete replenishment, deep sleep, and gentle recovery jogging over the next 48-72 hours.'
      : 'Commendable maximum effort. In your next benchmark, target an even or slight negative split to avoid early lactic burn.';
  } else if (runType === 'accidental_tempo' || isAccidentalTempo) {
    headline = 'Unintentional Tempo / Drifted Aerobic Run';
    recommendation = `If an Easy recovery was intended, slow your initial kilometer pace by 15-20 sec/km to keep heart rate firmly under your LT1 ceiling (${lt1} bpm).`;
  } else if (runType === 'recovery') {
    headline = 'Low-Stress Active Recovery Jog';
    recommendation = 'Superb discipline keeping heart rate low and muscle tissue unstressed. Ready for your next scheduled quality day.';
  } else if (runType === 'easy_base' || runType === 'long_run') {
    headline = finalScore >= 90 ? 'Near-Perfect Aerobic Base Execution' : 'Productive Zone 2 Aerobic Foundation';
    recommendation = decouplingPct !== null && decouplingPct < 4.0
      ? 'Your aerobic system is absorbing current volume smoothly. Ready for a progressive tempo or threshold stimulus.'
      : 'Maintain easy efforts at this heart rate cap to reinforce mitochondrial density.';
  } else if (runType === 'threshold_lt2') {
    headline = finalScore >= 75 ? 'High-Quality Lactate Clearance Stimulus' : 'Threshold Stimulus with Compromised Execution';
    recommendation = 'Allow 48 hours of recovery or easy aerobic jogging before your next quality interval day.';
  } else if (runType === 'intervals_vo2') {
    headline = finalScore >= 90 ? 'Masterful VO2 Max Interval Execution' : 'Sharp High-Velocity Neuromuscular Stimulus';
    recommendation = 'Focus on leg recovery and adequate protein intake to rebuild fast-twitch muscle fibers.';
  }

  if (hasMarathonPaceBlocks) {
    headline = 'Marathon-Pace Long Run';
    recommendation = 'Review the work blocks against your planned marathon pace. The easy-run heart-rate ceiling does not apply to those blocks.';
    insights.add('neutral', 'Marathon-Pace Context: This session includes marathon-pace work. Complete block boundaries and a planned pace target are needed before judging execution.');
  }

  // Unmeasured rubric factors are reported so a thin telemetry day is visible.
  if (rubric.coveragePct < 100) {
    insights.add('neutral', `Rubric Coverage: ${rubric.coveragePct}% of the grading rubric was measurable for this session, so the execution score is based only on the signals recorded.`);
  }

  return {
    headline,
    verdict: rubric.verdict,
    effectivenessScore: finalScore,
    rating5,
    stars,
    keyInsights: insights.texts,
    insightTones: insights.tones,
    recommendation,
    focusAdvice: rubric.focusAdvice,
    rubricCoveragePct: rubric.coveragePct,
    rubricFamily: rubric.family,
    context: params.history ?? null,
    scoreBreakdown: hasMarathonPaceBlocks ? [] : rubric.factors
  };
}

/**
 * Synchronizes and persists the Coach AI summary into the dedicated `activity_coach_summaries` table.
 * Continuously called on ingestion, activity edits, profile updates, and on-demand fetches.
 */
export function syncActivityCoachSummary(
  db: any,
  activityId: string,
  overrides?: any
): CoachSummary | null {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId) as any;
  if (!activity) return null;

  const records = db.prepare('SELECT * FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(activityId) as any[];
  const pauseBreakdown = extractSteadyStateMetrics(records);
  const intervals = db.prepare('SELECT * FROM activity_intervals WHERE activity_id = ? ORDER BY interval_index ASC').all(activityId) as any[];
  const splits = db.prepare('SELECT * FROM activity_splits WHERE activity_id = ? ORDER BY split_index ASC').all(activityId) as any[];

  const { maxHr: maxHeartRate, restingHr, lt1Hr, lt2Hr } = getAthleteHeartRateProfile(db);

  // Personal baseline comparison against the athlete's own prior comparable runs.
  // Steady-state values win over the raw columns so the pace-specific comparison
  // lines up with the metrics the rubric grades.
  const history = loadCoachHistoryContext(db, {
    ...activity,
    steady_pace_sec_km: pauseBreakdown.steadyPaceSecKm ?? activity.steady_pace_sec_km ?? null,
    steady_heart_rate: pauseBreakdown.steadyHeartRate ?? activity.steady_heart_rate ?? null
  });

  let sessionTags: string[] = [];
  try { sessionTags = JSON.parse(activity.tags || '[]'); } catch { /* Older rows can have malformed tags. */ }
  const coachSummary = generateCoachSummary({
    sessionTags: Array.isArray(sessionTags) ? sessionTags : [],
    runType: overrides?.runType || activity.run_type || 'easy_base',
    distanceKm: (activity.distance_meters || 0) / 1000,
    durationMin: (activity.duration_seconds || 0) / 60,
    avgPaceSecKm: activity.avg_pace_sec_km || (activity.distance_meters ? Math.round((activity.duration_seconds / activity.distance_meters) * 1000) : 0),
    avgHr: activity.avg_heart_rate || 0,
    maxHr: activity.max_heart_rate || 0,
    cadence: activity.avg_cadence || 0,
    decouplingPct: activity.aerobic_decoupling_pct ?? null,
    efficiencyFactor: activity.efficiency_factor ?? null,
    avgTemp: activity.avg_temperature ?? null,
    groundContactTime: activity.avg_stance_time ?? null,
    elevationGainM: activity.elevation_gain_m ?? null,
    steadyPaceSecKm: pauseBreakdown.steadyPaceSecKm || activity.steady_pace_sec_km || null,
    steadyHr: pauseBreakdown.steadyHeartRate || activity.steady_heart_rate || null,
    steadyCadence: pauseBreakdown.steadyCadence || activity.steady_cadence || null,
    steadyStanceTime: pauseBreakdown.steadyStanceTimeMs || activity.steady_stance_time || null,
    pauseBreakdown,
    lt1Hr,
    lt2Hr,
    maxHeartRate,
    restingHr,
    weatherTempC: activity.weather_temperature_c ?? null,
    weatherHumidityPct: activity.weather_humidity_pct ?? null,
    weatherApparentTempC: activity.weather_apparent_temp_c ?? null,
    weatherCondition: activity.weather_condition ?? null,
    isFailedWorkout: overrides?.isFailedWorkout ?? new RegExp('failed|aborted|dnf|bailed', 'i').test(activity.name || ''),
    intervals: overrides?.intervals || intervals,
    splits: overrides?.splits || splits,
    records,
    history,
    ...overrides
  });

  const analysis = {
    verdict: coachSummary.verdict,
    context: coachSummary.context ?? null,
    focusAdvice: coachSummary.focusAdvice ?? null,
    rubricCoveragePct: coachSummary.rubricCoveragePct ?? null,
    rubricFamily: coachSummary.rubricFamily ?? null,
    walkAudit: coachSummary.walkAudit ?? null
  };

  try {
    db.prepare(`
      INSERT INTO activity_coach_summaries (
        activity_id, headline, effectiveness_score, key_insights_json, insight_tones_json,
        recommendation, steady_pace_sec_km, steady_heart_rate,
        steady_cadence, steady_stance_time, pause_breakdown_json, score_breakdown_json,
        analysis_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(activity_id) DO UPDATE SET
        headline = excluded.headline,
        effectiveness_score = excluded.effectiveness_score,
        key_insights_json = excluded.key_insights_json,
        insight_tones_json = excluded.insight_tones_json,
        recommendation = excluded.recommendation,
        steady_pace_sec_km = excluded.steady_pace_sec_km,
        steady_heart_rate = excluded.steady_heart_rate,
        steady_cadence = excluded.steady_cadence,
        steady_stance_time = excluded.steady_stance_time,
        pause_breakdown_json = excluded.pause_breakdown_json,
        score_breakdown_json = excluded.score_breakdown_json,
        analysis_json = excluded.analysis_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      activityId,
      coachSummary.headline,
      coachSummary.effectivenessScore,
      JSON.stringify(coachSummary.keyInsights),
      JSON.stringify(coachSummary.insightTones || []),
      coachSummary.recommendation,
      pauseBreakdown.steadyPaceSecKm,
      pauseBreakdown.steadyHeartRate,
      pauseBreakdown.steadyCadence,
      pauseBreakdown.steadyStanceTimeMs,
      JSON.stringify(pauseBreakdown),
      JSON.stringify(coachSummary.scoreBreakdown),
      JSON.stringify(analysis)
    );

    const row = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get(activityId) as any;
    if (row) {
      const scoreVal = row.effectiveness_score;
      const starsVal = scoreVal >= 85 ? 3 : scoreVal >= 70 ? 2 : 1;
      let parsedAnalysis: any = null;
      try {
        parsedAnalysis = row.analysis_json ? JSON.parse(row.analysis_json) : null;
      } catch {
        parsedAnalysis = null;
      }
      return {
        headline: row.headline,
        verdict: parsedAnalysis?.verdict ?? coachSummary.verdict,
        effectivenessScore: scoreVal,
        rating5: Number((scoreVal / 20).toFixed(1)),
        stars: starsVal,
        keyInsights: JSON.parse(row.key_insights_json || '[]'),
        // Rows written before tones existed have no column value yet; the UI
        // falls back to an uncoloured list until the row is re-synced.
        insightTones: row.insight_tones_json ? JSON.parse(row.insight_tones_json) : [],
        recommendation: row.recommendation,
        scoreBreakdown: row.score_breakdown_json ? JSON.parse(row.score_breakdown_json) : coachSummary.scoreBreakdown,
        focusAdvice: parsedAnalysis?.focusAdvice ?? coachSummary.focusAdvice ?? null,
        rubricCoveragePct: parsedAnalysis?.rubricCoveragePct ?? coachSummary.rubricCoveragePct,
        rubricFamily: parsedAnalysis?.rubricFamily ?? coachSummary.rubricFamily,
        context: parsedAnalysis?.context ?? coachSummary.context ?? null,
        updatedAt: row.updated_at,
        steadyPaceSecKm: row.steady_pace_sec_km,
        steadyHeartRate: row.steady_heart_rate,
        steadyCadence: row.steady_cadence,
        steadyStanceTime: row.steady_stance_time,
        pauseBreakdown: row.pause_breakdown_json ? JSON.parse(row.pause_breakdown_json) : pauseBreakdown
      };
    }
  } catch (err) {
    // Non-fatal if table not ready
  }

  return coachSummary;
}

/**
 * Re-evaluates and updates all coach summaries across all activities.
 * Useful when athlete profile thresholds, gear, or baseline changes.
 */
export function syncAllCoachSummaries(db: any): number {
  const activities = db.prepare('SELECT id FROM activities').all() as Array<{ id: string }>;
  let count = 0;
  for (const act of activities) {
    if (syncActivityCoachSummary(db, act.id)) {
      count++;
    }
  }
  return count;
}

