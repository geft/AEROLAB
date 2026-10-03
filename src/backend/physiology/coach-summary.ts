import { coachMessage } from '../domain/coaching/messages.js';
import { ANALYSIS_REVISION, type AnalysisProvenance } from '../../shared/analysis-revision.js';
import { parseClassificationEvidence, type ClassificationEvidence } from '../../shared/contracts/classification.js';
import { assertDatabaseWritable } from '../application/database-operations.js';
import { parseCoachMessages, type CoachMessages } from '../../shared/coaching.js';
import type { SessionVerdict } from '../../shared/session-verdict.js';
import { getHeartRateProfileAtDate } from './threshold-tracker.js';
import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { PauseBreakdown, extractSteadyStateMetrics } from './economy.js';
import { ZoneDistribution } from './zones.js';
import { RubricFactor, type WalkAudit, gradeRun, intensityAudit, driftTargetFor, describeSet, betweenRepRecoveries, intervalDrop, intervalDuration, intervalHr, intervalMaxHr, selectRaceSplits, formatPaceText } from './coach-rubric.js';
import { CoachContext, buildContextInsights, loadCoachHistoryContext } from './coach-history.js';
import { createInsightLog, type CoachInsightTone } from './coach-insight.js';
import { verifiedAmbientTemperature } from './weather.js';
import Database from 'better-sqlite3';
import { activityFromRow, coachSummaryFromRow, objectRow } from '../db/rows.js';
import { loadAnalysisRecords, analysisRecordToRow } from '../db/analysis-records.js';
import { parseSessionVerdict } from '../../shared/session-verdict.js';
import { qualityWorkoutFailed } from '../ingestion/classifier.js';

/** One graded line of the weighted execution rubric. */
export type ScoreFactor = RubricFactor;

export interface CoachSummary {
  classificationEvidence?: ClassificationEvidence;
  analysisProvenance?: AnalysisProvenance;
  messages?: CoachMessages;
  verdict: SessionVerdict;
  headline: string;
  effectivenessScore: number; // 0 - 100
  rating5: number; // 1.0 - 5.0 rating scale
  stars: number; // 1 - 3 stars: Bronze, Silver, Gold
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
  walkAudit?: WalkAudit | null;
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
  weatherPm25?: number | null;
  weatherPm25Source?: 'nea-sg' | 'open-meteo' | null;
  recentAverageWeatherTempC?: number | null;
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
  const ambientTempC = params.weatherTempC ?? null;

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
  const driftTarget = driftTargetFor(ambientTempC, params.durationMin ?? null);
  if (isSteadyAerobic && decouplingPct !== null) {
    const conditionNote = driftTarget.conditionsAdjusted
      ? `${ambientTempC !== null ? ` ${ambientTempC}°C` : ' these conditions'} over ${Math.round(params.durationMin)} min`
      : '';
    if (decouplingPct <= driftTarget.fullAtPct) {
      insights.add('positive', `Superb cardiovascular stability with only ${decouplingPct.toFixed(1)}% drift, at or inside the ${driftTarget.fullAtPct}% target that${conditionNote || ' these conditions'} predict. Your aerobic capillary base is working efficiently with zero late-run cardiac fatigue.`);
    } else if (decouplingPct < driftTarget.fullAtPct + 3.0) {
      insights.add('positive', `Solid aerobic discipline. Decoupling was ${decouplingPct.toFixed(1)}%, just above the ${driftTarget.fullAtPct}% working target for${conditionNote || ' these conditions'} but well within the sub-LT1 gold standard threshold (<5%).`);
    } else {
      insights.add('caution', `Noticeable cardiac drift detected (${decouplingPct.toFixed(1)}% against a ${driftTarget.fullAtPct}% target for${conditionNote || ' these conditions'}). Likely due to thermal strain${ambientTempC !== null ? ` (${ambientTempC}°C)` : ''}, dehydration, or pacing slightly ahead of current aerobic capacity.`);
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
    const lowerCondition = (params.weatherCondition || '').toLowerCase();
    const precipNote = /rain|drizzle|snow|sleet|hail/.test(lowerCondition)
      ? ` Precipitation conditions (${params.weatherCondition}) may have affected comfort and footing.`
      : '';
    const warmerNote = params.recentAverageWeatherTempC != null && params.weatherTempC >= params.recentAverageWeatherTempC + 1.5
      ? ` Warmer than your recent fetched-run average (${params.recentAverageWeatherTempC.toFixed(1)}°C), adding heat strain.`
      : '';
    insights.add('neutral', `Microclimate Weather: ${params.weatherTempC}°C ambient${condStr}${humidStr}${feelsLikeStr}${watchStr}. ${
      params.weatherHumidityPct && params.weatherHumidityPct >= 80
        ? 'High tropical humidity restricts evaporative cooling and directly explains elevated cardiac drift.'
        : 'Microclimate weather verified from local meteorological reanalysis.'
    }${precipNote}${warmerNote}`);
  }

  // Air quality belongs in the watch-outs, not only inside neutral weather
  // context, so it remains visible when the athlete filters to issues.
  if (params.weatherPm25 != null && params.weatherPm25Source === 'nea-sg' && params.weatherPm25 > 55) {
    const band = params.weatherPm25 <= 150 ? 'Elevated' : params.weatherPm25 <= 250 ? 'High' : 'Very High';
    insights.add('caution', `Air Quality Watch: NEA's nearest regional monitor measured ${params.weatherPm25.toFixed(0)} µg/m³ PM2.5 near the run midpoint (${band} 1-hour band). Haze may have added breathing strain; the reading represents the wider region, not the exact route.`);
  } else if (params.weatherPm25 != null && params.weatherPm25Source === 'open-meteo' && params.weatherPm25 >= 56) {
    insights.add('caution', `Air Quality Estimate: Open-Meteo modeled midpoint PM2.5 at ${params.weatherPm25.toFixed(1)} µg/m³. This coarse model estimate may indicate haze, but is not a local monitor reading.`);
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
    restingHr: hrProfile.restingHr,
    activityMaxHr: params.maxHr || null,
    ambientTempC,
    durationMin: params.durationMin ?? null,
    pauseBreakdown,
    records: params.records ?? null,
    intervals: params.intervals,
    splits: params.splits
  });

  const finalScore = rubric.score;
  if (runType === 'threshold_lt2') {
    const zoneFactor = rubric.factors.find(factor => factor.categoryId === 'threshold_zone_time');
    if (zoneFactor) {
      insights.add(zoneFactor.points >= 40 ? 'positive' : 'caution', `Threshold Heart Rate: ${zoneFactor.description}. Time near the LT2 range is the primary measure of this session; pace is supporting context.`);
    } else {
      insights.add('caution', 'Threshold Heart Rate: Work-rep heart-rate coverage was insufficient to verify time in the threshold zone. This session cannot earn a gold threshold grade from pace alone.');
    }
  }
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
    const band = `${intensity.lt1Hr - 5}-${intensity.lt1Hr}`;
    if (above <= 5 && zone2 < 40) {
      const aboveText = Number(above.toFixed(1)) === 0
        ? ''
        : `only ${above.toFixed(1)}% of your running time sat above the ${intensity.lt1Hr} bpm LT1 ceiling; `;
      insights.add(
        'positive',
        `Clearly Easy: ${aboveText}${zone2.toFixed(1)}% of your running time sat in upper Zone 2 (${band} bpm), below the 40% clearly-easy guide. That’s a normal easy-run distribution.`
      );
    } else if (above <= 5 && zone2 < 60) {
      insights.add(
        'neutral',
        `Normal Easy: you never crossed the ${intensity.lt1Hr} bpm LT1 ceiling, and ${zone2.toFixed(1)}% of your running time sat in upper Zone 2 (${band} bpm), within the 40-60% normal-easy range. Keep the opening relaxed and let heart rate rise naturally.`
      );
    } else if (above <= 5) {
      const classification = zone2 <= 75 ? 'upper-easy / aerobic steady' : 'potentially too close to LT1 for a routine easy day';
      insights.add(
        'caution',
        `Zone 2 Ceiling Held, High-Zone-2 Creep: you never crossed the ${intensity.lt1Hr} bpm LT1 ceiling, but ${zone2.toFixed(1)}% of your running time sat in upper Zone 2 (${band} bpm), rising to ${intensity.highZ2SecondHalfPct.toFixed(0)}% in the second half. This is ${classification}${ambientTempC !== null && ambientTempC >= 28 ? `; in ${Math.round(ambientTempC)}°C much of the late creep may be heat-related` : ''}. Ease the opening kilometres and aim nearer ${intensity.lt1Hr - 10} bpm on a routine easy day.`
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

  let headlineMessage = coachMessage('headline.strong_aerobic_adaptation_session');
  let recommendationMessage = coachMessage('advice.prioritize_light_hydration_and_low_impact_movement_before');

  if (params.isFailedWorkout) {
    headlineMessage = coachMessage('headline.incomplete_aborted_quality_session');
    recommendationMessage = coachMessage('advice.assess_underlying_fatigue_heat_stress_or_nutrition_take');
  } else if (runType === 'race') {
    headlineMessage = finalScore >= 85 ? coachMessage('headline.all_out_benchmark_masterful_race_execution') : coachMessage('headline.all_out_benchmark_effort_erratic_pacing');
    recommendationMessage = finalScore >= 85 ? coachMessage('advice.exceptional_competitive_effort_prioritize_complete_replenishment_deep_sleep') : coachMessage('advice.commendable_maximum_effort_in_your_next_benchmark_target');
  } else if (runType === 'accidental_tempo' || isAccidentalTempo) {
    headlineMessage = coachMessage('headline.unintentional_tempo_drifted_aerobic_run');
    recommendationMessage = coachMessage('advice.easy_recovery_lt1_ceiling', { lt1 });
  } else if (runType === 'recovery') {
    headlineMessage = coachMessage('headline.low_stress_active_recovery_jog');
    recommendationMessage = coachMessage('advice.superb_discipline_keeping_heart_rate_low_and_muscle');
  } else if (runType === 'easy_base' || runType === 'long_run') {
    headlineMessage = finalScore >= 90 ? coachMessage('headline.near_perfect_aerobic_base_execution') : coachMessage('headline.productive_zone_2_aerobic_foundation');
    recommendationMessage = decouplingPct !== null && decouplingPct < 4.0 ? coachMessage('advice.your_aerobic_system_is_absorbing_current_volume_smoothly') : coachMessage('advice.maintain_easy_efforts_at_this_heart_rate_cap');
  } else if (runType === 'tempo') {
    headlineMessage = coachMessage('headline.sustained_upper_aerobic_tempo');
    recommendationMessage = coachMessage('advice.review_tempo_against_planned_target');
  } else if (runType === 'threshold_lt2') {
    headlineMessage = !rubric.factors.some(factor => factor.categoryId === 'threshold_zone_time') ? coachMessage('headline.threshold_zone_not_verified') : finalScore >= 85 ? coachMessage('headline.high_quality_lactate_clearance_stimulus') : coachMessage('headline.threshold_stimulus_with_compromised_execution');
    recommendationMessage = coachMessage('advice.allow_48_hours_of_recovery_or_easy_aerobic');
  } else if (runType === 'intervals_vo2') {
    headlineMessage = finalScore >= 90 ? coachMessage('headline.masterful_vo2_max_interval_execution') : coachMessage('headline.sharp_high_velocity_neuromuscular_stimulus');
    recommendationMessage = coachMessage('advice.focus_on_leg_recovery_and_adequate_protein_intake');
  }

  if (hasMarathonPaceBlocks) {
    headlineMessage = coachMessage('headline.marathon_pace_long_run');
    recommendationMessage = coachMessage('advice.review_the_work_blocks_against_your_planned_marathon');
    insights.add('neutral', 'Marathon-Pace Context: This session includes marathon-pace work. Complete block boundaries and a planned pace target are needed before judging execution.');
  }

  // Unmeasured rubric factors are reported so a thin telemetry day is visible.
  if (rubric.coveragePct < 100) {
    insights.add('neutral', `Rubric Coverage: ${rubric.coveragePct}% of the grading rubric was measurable for this session, so the execution score is based only on the signals recorded.`);
  }

  return {
    messages: { headline: headlineMessage, recommendation: recommendationMessage },
    headline: headlineMessage.text,
    verdict: rubric.verdict,
    effectivenessScore: finalScore,
    rating5,
    stars,
    keyInsights: insights.texts,
    insightTones: insights.tones,
    recommendation: recommendationMessage.text,
    focusAdvice: rubric.focusAdvice,
    rubricCoveragePct: rubric.coveragePct,
    rubricFamily: rubric.family,
    context: params.history ? {
      ...params.history,
      currentAboveCeilingPct: rubric.intensity?.aboveCeilingPct ?? null
    } : null,
    scoreBreakdown: hasMarathonPaceBlocks ? [] : rubric.factors
  };
}

/**
 * Synchronizes and persists the Coach AI summary into the dedicated `activity_coach_summaries` table.
 * Continuously called on ingestion, activity edits, profile updates, and on-demand fetches.
 */
export function syncActivityCoachSummary(
  db: Database.Database,
  activityId: string,
  overrides?: { runType?: string; isFailedWorkout?: boolean; intervals?: unknown[]; splits?: unknown[] },
  options: { persist?: boolean; classificationEvidence?: ClassificationEvidence } = {}
): CoachSummary | null {
  const activityValue: unknown = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId);
  if (!activityValue) return null;
  const activity = activityFromRow(activityValue);
  const confirmedFailure = objectRow(activityValue, 'activities').manual_failed_workout;

  const validateRows = (values: unknown[], table: string, numericFields: string[], stringFields: string[] = []): Array<Record<string, unknown>> => values.map(value => {
    const row = objectRow(value, table);
    for (const key of numericFields) {
      const field = row[key];
      if (field != null && (typeof field !== 'number' || !Number.isFinite(field))) throw new Error(`Invalid ${table}.${key}`);
    }
    for (const key of stringFields) if (row[key] != null && typeof row[key] !== 'string') throw new Error(`Invalid ${table}.${key}`);
    return row;
  });

  const records = loadAnalysisRecords(db, activityId).map(analysisRecordToRow);
  const pauseBreakdown = extractSteadyStateMetrics(records);
  const intervals = validateRows(db.prepare('SELECT * FROM activity_intervals WHERE activity_id = ? ORDER BY interval_index ASC').all(activityId), 'activity_intervals',
    ['interval_index', 'start_seconds', 'duration_seconds', 'distance_meters', 'avg_speed_mps', 'avg_pace_sec_km', 'avg_heart_rate', 'max_heart_rate', 'avg_cadence', 'peak_cadence', 'peak_speed_mps', 'peak_pace_sec_km', 'min_stance_time', 'hr_drop', 'avg_vert_osc', 'avg_stance_time', 'avg_step_length', 'avg_stride_length', 'avg_vert_ratio'], ['type']);
  const splits = validateRows(db.prepare('SELECT * FROM activity_splits WHERE activity_id = ? ORDER BY split_index ASC').all(activityId), 'activity_splits',
    ['split_index', 'distance_meters', 'duration_seconds', 'avg_pace_sec_km', 'avg_heart_rate', 'split_efficiency_factor', 'elevation_change_m', 'avg_cadence', 'avg_stance_time', 'avg_vert_osc', 'avg_vert_ratio']);

  const { maxHr: maxHeartRate, restingHr, lt1Hr, lt2Hr } = getHeartRateProfileAtDate(db, activity.start_time, activityId);

  // Personal baseline comparison against the athlete's own prior comparable runs.
  // Steady-state values win over the raw columns so the pace-specific comparison
  // lines up with the metrics the rubric grades.
  const history = loadCoachHistoryContext(db, {
    ...activity,
    steady_pace_sec_km: pauseBreakdown.steadyPaceSecKm ?? activity.steady_pace_sec_km ?? null,
    steady_heart_rate: pauseBreakdown.steadyHeartRate ?? activity.steady_heart_rate ?? null
  });
  if (history?.lastSimilarRun) {
    const priorRecords = loadAnalysisRecords(db, history.lastSimilarRun.id).map(analysisRecordToRow);
    const threshold = getHeartRateProfileAtDate(db, history.lastSimilarRun.startTime, history.lastSimilarRun.id).lt1Hr;
    history.lastSimilarRun.aboveCeilingPct = intensityAudit(priorRecords, { lt1Hr: threshold })?.aboveCeilingPct ?? null;
  }

  let sessionTags: string[] = [];
  try { sessionTags = JSON.parse(activity.tags || '[]'); } catch { /* Older rows can have malformed tags. */ }
  const weatherBaselineRow = db.prepare(`
    SELECT AVG(weather_temperature_c) AS avg_temp FROM (
      SELECT weather_temperature_c FROM activities
      WHERE id <> ? AND start_time < ? AND weather_source = 'open-meteo' AND weather_temperature_c IS NOT NULL
      ORDER BY start_time DESC LIMIT 12
    )
  `).get(activityId, activity.start_time) as { avg_temp: number | null } | undefined;
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
    weatherTempC: verifiedAmbientTemperature(activity),
    weatherHumidityPct: activity.weather_humidity_pct ?? null,
    weatherApparentTempC: activity.weather_apparent_temp_c ?? null,
    weatherCondition: activity.weather_condition ?? null,
    weatherPm25: activity.weather_pm25_ug_m3 ?? null,
    weatherPm25Source: activity.weather_pm25_source ?? null,
    recentAverageWeatherTempC: weatherBaselineRow?.avg_temp ?? null,
    isFailedWorkout: overrides?.isFailedWorkout ?? (confirmedFailure == null ? qualityWorkoutFailed(
      overrides?.runType || activity.run_type || 'easy_base',
      intervals.filter(interval => interval.type === 'work').map(interval => ({
        durationSeconds: (interval.duration_seconds as number | null) ?? 0,
        maxHeartRate: (interval.max_heart_rate as number | null) ?? 0
      })), { maxHr: maxHeartRate, restingHr, lt1Hr, lt2Hr }
    ) : confirmedFailure === 1),
    intervals: overrides?.intervals || intervals,
    splits: overrides?.splits || splits,
    records,
    history,
    ...overrides
  });

  const previousAnalysis = db.prepare('SELECT analysis_json FROM activity_coach_summaries WHERE activity_id = ?').get(activityId) as { analysis_json: string | null } | undefined;
  let previousEvidence: ClassificationEvidence | undefined;
  try {
    const previous: unknown = previousAnalysis?.analysis_json ? JSON.parse(previousAnalysis.analysis_json) : null;
    if (previous && typeof previous === 'object' && 'classificationEvidence' in previous) previousEvidence = parseClassificationEvidence(previous.classificationEvidence);
  } catch { /* Legacy summaries do not carry classification evidence. */ }
  coachSummary.classificationEvidence = options.classificationEvidence ?? previousEvidence;
  coachSummary.analysisProvenance = { revision: ANALYSIS_REVISION, workoutStartTime: activity.start_time,
    historicalProfile: { maxHr: maxHeartRate, restingHr, lt1Hr, lt2Hr }, telemetryPolicy: 'fit-timer-and-observed-gaps-v1' };
  const analysis = {
    revision: ANALYSIS_REVISION,
    classificationEvidence: coachSummary.classificationEvidence,
    provenance: coachSummary.analysisProvenance,
    messages: coachSummary.messages,
    verdict: coachSummary.verdict,
    context: coachSummary.context ?? null,
    focusAdvice: coachSummary.focusAdvice ?? null,
    rubricCoveragePct: coachSummary.rubricCoveragePct ?? null,
    rubricFamily: coachSummary.rubricFamily ?? null,
    walkAudit: coachSummary.walkAudit ?? null
  };

  if (options.persist === false) return coachSummary;
  assertDatabaseWritable();

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

  const rowValue: unknown = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get(activityId);
  if (rowValue) {
    const row = coachSummaryFromRow(rowValue);
    const scoreVal = row.effectiveness_score;
    const starsVal = scoreVal >= 85 ? 3 : scoreVal >= 70 ? 2 : 1;
    let parsedAnalysis: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = row.analysis_json ? JSON.parse(row.analysis_json) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) parsedAnalysis = parsed as Record<string, unknown>;
    } catch {
      parsedAnalysis = null;
    }
    const parseJsonArray = (json: string | null, fallback: unknown[] = []): unknown[] => {
      if (!json) return fallback;
      try { const parsed: unknown = JSON.parse(json); return Array.isArray(parsed) ? parsed : fallback; }
      catch { return fallback; }
    };
    const stringArray = (json: string, fallback: string[]): string[] => {
      const parsed = parseJsonArray(json);
      return parsed.every(item => typeof item === 'string') ? parsed as string[] : fallback;
    };
    const toneArray = (json: string | null, fallback: CoachInsightTone[]): CoachInsightTone[] => {
      const parsed = parseJsonArray(json);
      return parsed.every(item => item === 'positive' || item === 'neutral' || item === 'caution' || item === 'negative')
        ? parsed as CoachInsightTone[] : fallback;
    };
    const scoreArray = (json: string | null): RubricFactor[] => {
      const parsed = parseJsonArray(json);
      if (!parsed.every(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const factor = item as Record<string, unknown>;
        return typeof factor.category === 'string' && typeof factor.label === 'string'
          && typeof factor.points === 'number' && Number.isFinite(factor.points)
          && typeof factor.maxPoints === 'number' && Number.isFinite(factor.maxPoints);
      })) return coachSummary.scoreBreakdown;
      return parsed as RubricFactor[];
    };
    const parsedFocusAdvice = parsedAnalysis?.focusAdvice;
    const parsedCoverage = parsedAnalysis?.rubricCoveragePct;
    const parsedFamily = parsedAnalysis?.rubricFamily;
    return {
      classificationEvidence: coachSummary.classificationEvidence,
      analysisProvenance: coachSummary.analysisProvenance,
      messages: parseCoachMessages(parsedAnalysis?.messages) ?? coachSummary.messages,
      headline: row.headline,
      verdict: parsedAnalysis ? parseSessionVerdict(parsedAnalysis.verdict) : coachSummary.verdict,
      effectivenessScore: scoreVal,
      rating5: Number((scoreVal / 20).toFixed(1)),
      stars: starsVal,
      keyInsights: stringArray(row.key_insights_json, coachSummary.keyInsights),
      // Rows written before tones existed have no column value yet; the UI
      // falls back to an uncoloured list until the row is re-synced.
      insightTones: toneArray(row.insight_tones_json, coachSummary.insightTones),
      recommendation: row.recommendation,
      scoreBreakdown: scoreArray(row.score_breakdown_json),
      focusAdvice: typeof parsedFocusAdvice === 'string' ? parsedFocusAdvice : coachSummary.focusAdvice ?? null,
      rubricCoveragePct: typeof parsedCoverage === 'number' && Number.isFinite(parsedCoverage) ? parsedCoverage : coachSummary.rubricCoveragePct,
      rubricFamily: parsedFamily === 'aerobic' || parsedFamily === 'quality' || parsedFamily === 'race' ? parsedFamily : coachSummary.rubricFamily,
      context: coachSummary.context ?? null,
      ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
      steadyPaceSecKm: row.steady_pace_sec_km,
      steadyHeartRate: row.steady_heart_rate,
      steadyCadence: row.steady_cadence,
      steadyStanceTime: row.steady_stance_time,
      pauseBreakdown
    };
  }


  return coachSummary;
}

/**
 * Re-evaluates and updates all coach summaries across all activities.
 * Useful when athlete profile thresholds, gear, or baseline changes.
 */
export function syncAllCoachSummaries(db: Database.Database, activityIds?: string[], classifications?: Map<string, ClassificationEvidence>): number {
  const rows = activityIds?.length
    ? db.prepare(`SELECT id FROM activities WHERE id IN (${activityIds.map(() => '?').join(',')})`).all(...activityIds)
    : db.prepare('SELECT id FROM activities').all();
  const activities = rows.map(value => {
    const row = objectRow(value, 'activities');
    if (typeof row.id !== 'string' || row.id.length === 0) throw new Error('Invalid activities.id');
    return { id: row.id };
  });
  let count = 0;
  for (const act of activities) {
    if (syncActivityCoachSummary(db, act.id, undefined, { classificationEvidence: classifications?.get(act.id) })) {
      count++;
    }
  }
  return count;
}
