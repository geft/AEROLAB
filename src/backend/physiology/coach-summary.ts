import { coachingInterval, coachingRecord, coachingSplit, type CoachingIntervalInput, type CoachingRecordInput, type CoachingSplitInput } from '../domain/coaching/telemetry.js';
import { coachMessage, coachJoin, coachWeatherCondition } from '../domain/coaching/messages.js';
import type { CoachMessage } from '../../shared/coaching.js';
import { ANALYSIS_REVISION, type AnalysisProvenance } from '../../shared/analysis-revision.js';
import { parseClassificationEvidence, type ClassificationEvidence } from '../../shared/contracts/classification.js';
import { assertDatabaseWritable } from '../application/database-operations.js';
import type { CoachMessages } from '../../shared/coaching.js';
import type { SessionVerdict } from '../../shared/session-verdict.js';
import { getHeartRateProfileAtDate } from './threshold-tracker.js';
import { calculateActivityTrainingLoad } from './training-load.js';
import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { PauseBreakdown, extractSteadyStateMetrics } from './economy.js';
import { ZoneDistribution } from './zones.js';
import { RubricFactor, type WalkAudit, gradeRun, intensityAudit, driftTargetFor, describeSet, betweenRepRecoveries, intervalDrop, intervalDuration, intervalHr, intervalMaxHr, selectRaceSplits, formatPaceText } from './coach-rubric.js';
import { CoachContext, buildContextInsights, loadCoachHistoryContext } from './coach-history.js';
import { createInsightLog, type CoachInsightTone } from './coach-insight.js';
import { verifiedAmbientTemperature } from './weather.js';
import Database from 'better-sqlite3';
import { activityFromRow, activityIntervalFromRow, activitySplitFromRow, objectRow } from '../db/rows.js';
import { loadAnalysisRecords } from '../db/analysis-records.js';
import { qualityWorkoutFailed } from '../ingestion/classifier.js';

/** One graded line of the weighted execution rubric. */
export type ScoreFactor = RubricFactor;

export interface CoachSummary {
  classificationEvidence?: ClassificationEvidence;
  analysisProvenance?: AnalysisProvenance;
  messages?: CoachMessages;
  insightMessages?: CoachMessage[];
  focusAdviceMessage?: CoachMessage | null;
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
  isTreadmill?: boolean;
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
  intervals?: CoachingIntervalInput[] | null;
  splits?: CoachingSplitInput[] | null;
  /** Per-second telemetry: lets the rubric judge *why* walk breaks happened. */
  records?: CoachingRecordInput[] | null;
  /** Personal-baseline comparison built from the athlete's own prior runs. */
  history?: CoachContext | null;
}): CoachSummary {
  const intervals = params.intervals?.map(coachingInterval);
  const records = params.records?.map(coachingRecord);
  const splits = params.splits?.map(coachingSplit);
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
  if (params.isTreadmill) insights.add('neutral', coachMessage('insight.treadmill_pace_context'));

  // Failed workout alert
  if (params.isFailedWorkout) {
    insights.add('negative', coachMessage("insight.incomplete_aborted_quality_effort_target_interval_volume_was"));
  }

  // 1. Explicit Traffic & Walk Break Isolation Insight
  if (pauseBreakdown && (pauseBreakdown.stopDurationSeconds > 0 || pauseBreakdown.walkDurationSeconds > 0)) {
    const parts: CoachMessage[] = [];
    if (pauseBreakdown.stopCount > 0 || pauseBreakdown.stopDurationSeconds > 0) {
      const stopMins = Math.floor(pauseBreakdown.stopDurationSeconds / 60);
      const stopSecs = pauseBreakdown.stopDurationSeconds % 60;
      const stopTimeStr = stopMins > 0 ? coachMessage("fragment.m_s", { p0: stopMins, p1: stopSecs }) : coachMessage("fragment.s", { p0: stopSecs });
      parts.push(coachMessage("fragment.stationary_traffic_stop_idle", { p0: pauseBreakdown.stopCount, p1: pauseBreakdown.stopCount === 1 ? '' : coachMessage("fragment.s_2"), p2: stopTimeStr }));
    }
    if (pauseBreakdown.walkCount > 0 || pauseBreakdown.walkDurationSeconds > 0) {
      const walkMins = Math.floor(pauseBreakdown.walkDurationSeconds / 60);
      const walkSecs = pauseBreakdown.walkDurationSeconds % 60;
      const walkTimeStr = walkMins > 0 ? coachMessage("fragment.m_s", { p0: walkMins, p1: walkSecs }) : coachMessage("fragment.s", { p0: walkSecs });
      parts.push(coachMessage("fragment.walk_break_m", { p0: pauseBreakdown.walkCount, p1: pauseBreakdown.walkCount === 1 ? '' : coachMessage("fragment.s_2"), p2: walkTimeStr, p3: Math.round(pauseBreakdown.walkDistanceMeters) }));
    }

    const cleanPaceStr = formatPaceText(effectivePaceSecKm);

    insights.add(
      'neutral',
      coachMessage("insight.traffic_walk_break_isolation_removed_from_steady_state", { p0: coachJoin(parts, ' and '), p1: cleanPaceStr, p2: effectiveHr, p3: effectiveCadence })
    );
  }

  // Aerobic decoupling / Cardiac Drift insight (applies ONLY to steady continuous aerobic runs)
  const isSteadyAerobic = runType === 'easy_base' || runType === 'long_run' || runType === 'recovery' || runType === 'accidental_tempo';
  const driftTarget = driftTargetFor(ambientTempC, params.durationMin ?? null);
  if (isSteadyAerobic && !params.isTreadmill && decouplingPct !== null) {
    const conditionNote = driftTarget.conditionsAdjusted ? coachMessage("fragment.over_min", { p0: ambientTempC !== null ? coachMessage("fragment.c", { p0: ambientTempC }) : coachMessage("fragment.these_conditions"), p1: Math.round(params.durationMin) }) : '';
    if (decouplingPct <= driftTarget.fullAtPct) {
      insights.add('positive', coachMessage("insight.superb_cardiovascular_stability_with_only_drift_at_or", { p0: decouplingPct.toFixed(1), p1: driftTarget.fullAtPct, p2: conditionNote || coachMessage('fragment.these_conditions') }));
    } else if (decouplingPct < driftTarget.fullAtPct + 3.0) {
      insights.add('positive', coachMessage("insight.solid_aerobic_discipline_decoupling_was_just_above_the", { p0: decouplingPct.toFixed(1), p1: driftTarget.fullAtPct, p2: conditionNote || coachMessage('fragment.these_conditions') }));
    } else {
      insights.add('caution', coachMessage("insight.noticeable_cardiac_drift_detected_against_a_target_for", { p0: decouplingPct.toFixed(1), p1: driftTarget.fullAtPct, p2: conditionNote || coachMessage('fragment.these_conditions'), p3: ambientTempC !== null ? coachMessage("fragment.c_2", { p0: ambientTempC }) : '' }));
    }
  }

  // Structured Interval Execution Quality (for VO2 Max & Threshold quality sessions)
  // Pace-free: duration consistency (structure) + peak-HR attainment (profile-relative).
  if ((runType === 'intervals_vo2' || runType === 'threshold_lt2') && intervals && intervals.length > 0) {
    const workReps = intervals.filter((i) => i.type === 'work');
    if (workReps.length >= 2) {
      const shape = describeSet(intervals);
      const durations = workReps
        .map((r) => r.durationSeconds)
        .filter((d: number) => d > 0);
      if (durations.length >= 2) {
        const meanDur = durations.reduce((a: number, b: number) => a + b, 0) / durations.length;
        const variance = durations.reduce((a: number, b: number) => a + Math.pow(b - meanDur, 2), 0) / durations.length;
        const stdDev = Math.sqrt(variance);
        const cv = meanDur > 0 ? stdDev / meanDur : 0;

        if (cv <= 0.08) {
          insights.add(
            'positive',
            coachMessage("insight.exceptional_rep_consistency_executed_work_reps_with_laser", { p0: workReps.length, p1: (cv * 100).toFixed(1), p2: Math.round(stdDev) })
          );
        } else if (cv <= 0.15) {
          insights.add(
            'positive',
            coachMessage("insight.disciplined_interval_structure_held_work_reps_consistently_duration", { p0: workReps.length, p1: (cv * 100).toFixed(1) })
          );
        } else if (cv > 0.25) {
          insights.add(
            'caution',
            coachMessage("insight.rep_variance_warning_high_duration_variance_across_reps", { p0: (cv * 100).toFixed(1) })
          );
        }
      }

      // Check Peak HR reached (true cardiovascular stimulus for VO2 Max)
      const maxWorkHr = Math.max(...workReps.map((r) => r.maxHeartRate));
      const maxProfileHr = hrProfile.maxHr;
      if (runType === 'intervals_vo2' && maxWorkHr > 0) {
        const pctMax = (maxWorkHr / maxProfileHr) * 100;
        if (pctMax >= 88) {
          insights.add(
            'positive',
            coachMessage("insight.target_vo2_stimulus_achieved_heart_rate_peaked_at", { p0: maxWorkHr, p1: pctMax.toFixed(0) })
          );
        }
      }

      // Work intensity: name the session's anchor and flag drift into another zone.
      {
        const hrs = workReps.map(intervalHr).filter((h: number) => h > 0);
        const peakHr = Math.max(0, ...workReps.map(intervalMaxHr));
        const anchorHr = shape?.shortReps && peakHr > 0
          ? peakHr
          : (hrs.length > 0 ? Math.round(hrs.reduce((a: number, b: number) => a + b, 0) / hrs.length) : 0);
        const overshoot = anchorHr - hrProfile.lt2Hr;
        if (anchorHr > 0 && runType !== 'intervals_vo2' && overshoot >= 12) {
          insights.add(
            'negative',
            coachMessage("insight.session_drift_work_reps_bpm_against_your_bpm", { p0: shape?.shortReps ? coachMessage("fragment.peaked_at") : coachMessage("fragment.averaged"), p1: anchorHr, p2: hrProfile.lt2Hr, p3: overshoot })
          );
        } else if (anchorHr > 0 && runType !== 'intervals_vo2' && overshoot <= -18) {
          insights.add(
            'caution',
            coachMessage("insight.session_drift_work_reps_averaged_bpm_bpm_below", { p0: anchorHr, p1: Math.abs(overshoot), p2: hrProfile.lt2Hr })
          );
        }
      }

      // Set profile: state the structure being judged, so the grade is readable
      // whether it was 3 x 15 min or 12 x 1 min.
      if (shape) {
        const fmtDuration = (sec: number) => (sec >= 60 ? coachMessage("fragment.m_s", { p0: Math.floor(sec / 60), p1: String(sec % 60).padStart(2, '0') }) : coachMessage("fragment.s", { p0: sec }));
        const recoveryNote = shape.recoverySec != null ? coachMessage("fragment.with_recoveries", { p0: fmtDuration(shape.recoverySec) }) : '';
        insights.add(
          'neutral',
          coachMessage("insight.set_profile_x_work_of_total_work_time", { p0: shape.repCount, p1: fmtDuration(shape.medianRepSec), p2: recoveryNote, p3: fmtDuration(shape.totalWorkSec) })
        );
      }

      // Recovery structure: reported, never scored — shortening recoveries is a
      // deliberate way to keep heart rate near threshold and extend time in zone.
      // betweenRepRecoveries owns the window, so warm-up stride jog-recoveries
      // cannot be averaged in with the set's real recoveries.
      const allIntervals = intervals;
      const recoveries = betweenRepRecoveries(allIntervals).filter((i) =>
        intervalDrop(i) > 0 && intervalDuration(i) >= 30
      );
      if (recoveries.length > 0) {
        const drops = recoveries.map((r) => intervalDrop(r));
        const avgDrop = Math.round(drops.reduce((a: number, b: number) => a + b, 0) / drops.length);
        const avgRecoverySec = Math.round(recoveries.reduce((a: number, r) => a + intervalDuration(r), 0) / recoveries.length);
        const bpmPerMin = Math.round(avgDrop / (avgRecoverySec / 60));
        if (avgRecoverySec <= 120) {
          insights.add(
            'neutral',
            coachMessage("insight.recovery_intent_recoveries_averaged_s_dropping_heart_rate", { p0: recoveries.length, p1: avgRecoverySec, p2: avgDrop, p3: bpmPerMin })
          );
        } else if (bpmPerMin < 8) {
          insights.add(
            'caution',
            coachMessage("insight.recovery_rate_recoveries_averaged_s_with_a_bpm", { p0: recoveries.length, p1: avgRecoverySec, p2: avgDrop, p3: bpmPerMin })
          );
        } else {
          insights.add(
            'positive',
            coachMessage("insight.recovery_rate_recoveries_averaged_s_with_a_bpm_2", { p0: recoveries.length, p1: avgRecoverySec, p2: avgDrop, p3: bpmPerMin })
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Race / Time Trial Execution: Pacing Discipline & Split Consistency
  // ---------------------------------------------------------------------------
  if (runType === 'race' && splits && splits.length >= 2) {
    const raceSplits = selectRaceSplits(splits, intervals);

    if (raceSplits.length >= 2) {
      const paces = raceSplits.map((s) => s.avgPaceSecKm || 0);
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
          coachMessage("insight.race_pacing_alert_opened_too_fast_in_the", { p0: fmt(firstPace), p1: fmt(secondPace), p2: Math.round(earlySurgeSec) })
        );
      } else if (cv <= 0.03) {
        insights.add(
          'positive',
          coachMessage("insight.masterful_race_pacing_maintained_exceptional_pacing_consistency_across", { p0: (cv * 100).toFixed(1), p1: Math.round(stdDev) })
        );
      }

      if (cv > 0.05 && !isEarlySurge) {
        insights.add(
          'caution',
          coachMessage("insight.erratic_race_pacing_split_paces_fluctuated_significantly_s", { p0: Math.round(stdDev) })
        );
      }
    }
  }

  // Cadence insight (evaluated on true steady-state running)
  if (effectiveCadence >= 172 && effectiveCadence <= 186) {
    insights.add('positive', coachMessage("insight.cadence_was_right_in_the_sweet_spot_spm", { p0: effectiveCadence }));
  } else if (effectiveCadence > 186) {
    insights.add('positive', coachMessage("insight.high_turnover_spm_maintained_during_steady_running_promoting", { p0: effectiveCadence }));
  } else if (effectiveCadence > 0 && effectiveCadence < 165) {
    insights.add('caution', coachMessage("insight.steady_running_cadence_averaged_spm_increasing_turnover_toward", { p0: effectiveCadence }));
  }

  // Running dynamics insight
  if (effectiveGct && effectiveGct < 260) {
    insights.add('positive', coachMessage("insight.swift_ground_reaction_ms_stance_time_demonstrates_crisp", { p0: Math.round(effectiveGct) }));
  }

  // Heat & Environment
  if (params.weatherTempC !== undefined && params.weatherTempC !== null) {
    const condStr = params.weatherCondition ? coachMessage("fragment.values", { p0: coachWeatherCondition(params.weatherCondition) }) : '';
    const humidStr = params.weatherHumidityPct ? coachMessage("fragment.with_humidity", { p0: params.weatherHumidityPct }) : '';
    const feelsLikeStr = params.weatherApparentTempC ? coachMessage("fragment.feels_like_c", { p0: params.weatherApparentTempC }) : '';
    const watchStr = avgTemp ? coachMessage("fragment.garmin_watch_sensor_c", { p0: avgTemp }) : '';
    const lowerCondition = (params.weatherCondition || '').toLowerCase();
    const precipNote = /rain|drizzle|snow|sleet|hail/.test(lowerCondition) ? coachMessage("fragment.precipitation_conditions_may_have_affected_comfort_and_footing", { p0: coachWeatherCondition(params.weatherCondition) }) : '';
    const warmerNote = params.recentAverageWeatherTempC != null && params.weatherTempC >= params.recentAverageWeatherTempC + 1.5 ? coachMessage("fragment.warmer_than_your_recent_fetched_run_average_c", { p0: params.recentAverageWeatherTempC.toFixed(1) }) : '';
    insights.add('neutral', coachMessage("insight.microclimate_weather_c_ambient", { p0: params.weatherTempC, p1: condStr, p2: humidStr, p3: feelsLikeStr, p4: watchStr, p5: params.weatherHumidityPct && params.weatherHumidityPct >= 80 ? coachMessage("fragment.high_tropical_humidity_restricts_evaporative_cooling_and_directly") : coachMessage("fragment.microclimate_weather_verified_from_local_meteorological_reanalysis"), p6: precipNote, p7: warmerNote }));
  }

  // Air quality belongs in the watch-outs, not only inside neutral weather
  // context, so it remains visible when the athlete filters to issues.
  if (params.weatherPm25 != null && params.weatherPm25Source === 'nea-sg' && params.weatherPm25 > 55) {
    const band = params.weatherPm25 <= 150 ? coachMessage("fragment.elevated") : params.weatherPm25 <= 250 ? coachMessage("fragment.high") : coachMessage("fragment.very_high");
    insights.add('caution', coachMessage("insight.air_quality_watch_nea_s_nearest_regional_monitor", { p0: params.weatherPm25.toFixed(0), p1: band }));
  } else if (params.weatherPm25 != null && params.weatherPm25Source === 'open-meteo' && params.weatherPm25 >= 56) {
    insights.add('caution', coachMessage("insight.air_quality_estimate_open_meteo_modeled_midpoint_pm2", { p0: params.weatherPm25.toFixed(1) }));
  }

  // Elevation ramp walk check
  if (params.elevationGainM && params.elevationGainM >= 15) {
    insights.add('neutral', coachMessage("insight.elevation_ramps_gained_m_ascent_uphill_grade_segments", { p0: Math.round(params.elevationGainM) }));
  }

  // Average HR is only a fallback; the rubric verifies recorded running intensity.
  const hrFloor = params.restingHr ? params.restingHr + 15 : 120;
  const averageSuggestsTempo = (runType === 'easy_base' || runType === 'accidental_tempo' || runType === 'recovery')
    && effectiveHr > hrFloor
    && effectiveHr > lt1;

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
    isAccidentalTempo: averageSuggestsTempo,
    lt1Hr: lt1,
    lt2Hr: hrProfile.lt2Hr,
    maxHeartRate: hrProfile.maxHr,
    restingHr: hrProfile.restingHr,
    activityMaxHr: params.maxHr || null,
    ambientTempC,
    durationMin: params.durationMin ?? null,
    pauseBreakdown,
    records: records ?? null,
    intervals: intervals,
    splits: splits
  });

  const isAccidentalTempo = rubric.isAccidentalTempo;
  if (isAccidentalTempo && !rubric.intensity) {
    insights.add('negative', coachMessage("insight.pacing_alert_heart_rate_drifted_notably_higher_than", { p0: effectiveHr }));
  }

  const finalScore = rubric.score;
  if (runType === 'threshold_lt2') {
    const zoneFactor = rubric.factors.find(factor => factor.categoryId === 'threshold_zone_time');
    if (zoneFactor) {
      insights.add(zoneFactor.points >= 40 ? 'positive' : 'caution', coachMessage("insight.threshold_heart_rate_time_near_the_lt2_range", { p0: zoneFactor.descriptionMessage ?? zoneFactor.description ?? '' }));
    } else {
      insights.add('caution', coachMessage("insight.threshold_heart_rate_work_rep_heart_rate_coverage"));
    }
  }
  // 3-tier star system: 1 = Bronze (<70), 2 = Silver (70-84), 3 = Gold (>=85)
  const stars = finalScore >= 85 ? 3 : finalScore >= 70 ? 2 : 1;
  const rating5 = Number(((finalScore / 20)).toFixed(1));

  // Walk breaks are coaching information, not a moral judgement: explain what
  // they were for, and only flag the ones that actually cost the session.
  const walkAudit = rubric.walkAudit;
  if (!params.isTreadmill && walkAudit && walkAudit.rawBlockCount > 0) {
    const walkPct = ((walkAudit.walkSec / walkAudit.movingSec) * 100).toFixed(1);
    const deliberateSec = walkAudit.deliberateWalkSec + walkAudit.preventiveWalkSec;
    if (walkAudit.recoveryWalkSec >= 20) {
      insights.add(
        'neutral',
        coachMessage("insight.interval_break_walking_s_of_walking_across_breaks", { p0: walkAudit.recoveryWalkSec, p1: walkAudit.recoveryBlockCount })
      );
    }
    if (walkAudit.artifactBlockCount >= 2) {
      insights.add(
        'neutral',
        coachMessage("insight.turnaround_dips_brief_cadence_dips_up_to_s", { p0: walkAudit.artifactBlockCount, p1: walkAudit.artifactWalkSec })
      );
    }
    if (!hasMarathonPaceBlocks && deliberateSec >= 30 && walkAudit.intrusiveWalkSec === 0 && walkAudit.capacityWalkSec === 0 && walkAudit.recoveryWalkSec === 0) {
      const entryHr = walkAudit.avgPreventiveEntryHr;
      const peakNote = walkAudit.maxEntryHr ? coachMessage("fragment.peaking_at_bpm", { p0: walkAudit.maxEntryHr }) : '';
      insights.add(
        'positive',
        coachMessage("insight.walk_break_strategy_walk_breaks_of_moving_time", { p0: walkAudit.blockCount, p1: walkPct, p2: entryHr ? coachMessage("fragment.average_entry_bpm", { p0: entryHr }) : '', p3: lt1, p4: peakNote })
      );
    }
    if (!hasMarathonPaceBlocks && walkAudit.intrusiveWalkSec >= 20) {
      insights.add(
        'negative',
        coachMessage("insight.work_rep_interruption_s_of_walking_began_inside", { p0: walkAudit.intrusiveWalkSec, p1: walkAudit.avgCorrectiveEntryHr ?? '—' })
      );
    }
    if (!hasMarathonPaceBlocks && walkAudit.capacityWalkSec >= 30) {
      insights.add(
        'negative',
        coachMessage("insight.unplanned_walking_s_of_mid_run_walking_started", { p0: walkAudit.capacityWalkSec, p1: walkAudit.avgCapacityEntryHr ?? '—' })
      );
    }
  }

  // Pacing stability is measured on the kilometres actually run, so city
  // navigation (lights, junctions, turns) is reported rather than charged.
  const pacing = rubric.pacing;
  if (!params.isTreadmill && pacing && pacing.source === 'records' && pacing.sampleCount >= 5 && pacing.affectedCount >= 1) {
    const trendNote = Math.abs(pacing.trendSecPerKm) >= 2
      ? coachMessage(pacing.trendSecPerKm > 0 ? 'fragment.pace_slowdown' : 'fragment.pace_progression', { delta: Math.abs(pacing.trendSecPerKm).toFixed(1) })
      : '';
    // A fading second half is worth flagging; a negative split is worth noting.
    const trendTone: CoachInsightTone = Math.abs(pacing.trendSecPerKm) < 2
      ? 'neutral'
      : (pacing.trendSecPerKm > 0 ? 'caution' : 'positive');
    insights.add(
      trendTone,
      coachMessage("insight.pacing_discipline_your_running_pace_held_within_s", { p0: Math.round(pacing.stdDevSec), p1: pacing.sampleCount, p2: trendNote, p3: pacing.affectedCount })
    );
  }

  // Aerobic intensity: the one thing an easy run is graded on.
  const intensity = rubric.intensity;
  if (intensity && rubric.family === 'aerobic') {
    const above = intensity.aboveCeilingPct;
    const zone2 = intensity.highZ2Pct;
    const band = `${intensity.lt1Hr - 5}-${intensity.lt1Hr}`;
    if (above <= 5 && zone2 < 40) {
      const aboveText = Number(above.toFixed(1)) === 0 ? '' : coachMessage("fragment.only_of_your_running_time_sat_above_the", { p0: above.toFixed(1), p1: intensity.lt1Hr });
      insights.add(
        'positive',
        coachMessage("insight.clearly_easy_of_your_running_time_sat_in", { p0: aboveText, p1: zone2.toFixed(1), p2: band })
      );
    } else if (above <= 5 && zone2 < 60) {
      insights.add(
        'neutral',
        coachMessage("insight.normal_easy_you_never_crossed_the_bpm_lt1", { p0: intensity.lt1Hr, p1: zone2.toFixed(1), p2: band })
      );
    } else if (above <= 5) {
      const classification = zone2 <= 75 ? coachMessage("fragment.upper_easy_aerobic_steady") : coachMessage("fragment.potentially_too_close_to_lt1_for_a_routine");
      insights.add(
        'caution',
        coachMessage("insight.zone_2_ceiling_held_high_zone_2_creep", { p0: intensity.lt1Hr, p1: zone2.toFixed(1), p2: band, p3: intensity.highZ2SecondHalfPct.toFixed(0), p4: classification, p5: ambientTempC !== null && ambientTempC >= 28 ? coachMessage("fragment.in_c_much_of_the_late_creep_may", { p0: Math.round(ambientTempC) }) : '', p6: intensity.lt1Hr - 10 })
      );
    } else if (above <= 20) {
      insights.add(
        'caution',
        coachMessage("insight.grey_zone_creep_of_running_time_was_above", { p0: above.toFixed(1), p1: intensity.lt1Hr, p2: intensity.firstHalfAboveCeilingPct.toFixed(1) })
      );
    } else {
      insights.add(
        'negative',
        coachMessage("insight.over_intensity_of_your_running_time_sat_above", { p0: above.toFixed(1), p1: intensity.lt1Hr, p2: intensity.firstHalfAboveCeilingPct.toFixed(1) })
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
    insights.add('neutral', coachMessage("insight.marathon_pace_context_this_session_includes_marathon_pace"));
  }

  // Unmeasured rubric factors are reported so a thin telemetry day is visible.
  if (rubric.coveragePct < 100) {
    insights.add('neutral', coachMessage("insight.rubric_coverage_of_the_grading_rubric_was_measurable", { p0: rubric.coveragePct }));
  }

  return {
    messages: { headline: headlineMessage, recommendation: recommendationMessage },
    headline: headlineMessage.text,
    verdict: rubric.verdict,
    effectivenessScore: finalScore,
    rating5,
    stars,
    keyInsights: insights.texts,
    insightMessages: insights.messages,
    insightTones: insights.tones,
    recommendation: recommendationMessage.text,
    focusAdvice: rubric.focusAdvice,
    focusAdviceMessage: rubric.focusAdviceMessage,
    rubricCoveragePct: rubric.coveragePct,
    rubricFamily: rubric.family,
    walkAudit: rubric.walkAudit,
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
  overrides?: { runType?: string; isFailedWorkout?: boolean; intervals?: CoachingIntervalInput[]; splits?: CoachingSplitInput[] },
  options: { persist?: boolean; classificationEvidence?: ClassificationEvidence } = {}
): CoachSummary | null {
  const activityValue: unknown = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId);
  if (!activityValue) return null;
  const activity = activityFromRow(activityValue);
  const confirmedFailure = objectRow(activityValue, 'activities').manual_failed_workout;

  const records = loadAnalysisRecords(db, activityId);
  const pauseBreakdown = extractSteadyStateMetrics(records);
  const intervals = db.prepare('SELECT * FROM activity_intervals WHERE activity_id = ? ORDER BY interval_index ASC').all(activityId).map(activityIntervalFromRow);
  const splits = db.prepare('SELECT * FROM activity_splits WHERE activity_id = ? ORDER BY split_index ASC').all(activityId).map(activitySplitFromRow);

  const profile = getHeartRateProfileAtDate(db, activity.start_time, activityId);
  const { maxHr: maxHeartRate, restingHr, lt1Hr, lt2Hr } = profile;

  // Personal baseline comparison against the athlete's own prior comparable runs.
  // Steady-state values win over the raw columns so the pace-specific comparison
  // lines up with the metrics the rubric grades.
  const history = loadCoachHistoryContext(db, {
    ...activity,
    steady_pace_sec_km: pauseBreakdown.steadyPaceSecKm ?? activity.steady_pace_sec_km ?? null,
    steady_heart_rate: pauseBreakdown.steadyHeartRate ?? activity.steady_heart_rate ?? null
  });
  if (history?.lastSimilarRun) {
    const priorRecords = loadAnalysisRecords(db, history.lastSimilarRun.id);
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
    isTreadmill: activity.is_treadmill,
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
    insightMessages: coachSummary.insightMessages,
    focusAdviceMessage: coachSummary.focusAdviceMessage,
    verdict: coachSummary.verdict,
    context: coachSummary.context ?? null,
    focusAdvice: coachSummary.focusAdvice ?? null,
    rubricCoveragePct: coachSummary.rubricCoveragePct ?? null,
    rubricFamily: coachSummary.rubricFamily ?? null,
    walkAudit: coachSummary.walkAudit ?? null
  };

  if (options.persist === false) return coachSummary;
  assertDatabaseWritable();

  const load = calculateActivityTrainingLoad(records, profile,
    { durationSeconds: activity.duration_seconds, avgHeartRate: activity.avg_heart_rate });
  db.transaction(() => {
    db.prepare(`UPDATE activities SET training_load=?,z1_seconds=?,z2_seconds=?,z3_seconds=?,z4_seconds=?,z5_seconds=? WHERE id=?`)
      .run(load.trainingLoad, load.zones.z1Seconds, load.zones.z2Seconds, load.zones.z3Seconds,
        load.zones.z4Seconds, load.zones.z5Seconds, activityId);
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
  })();

  // The values just generated and persisted are already validated domain data.
  // Read only the database-generated timestamp, rather than reparsing our JSON.
  const stored = db.prepare('SELECT updated_at FROM activity_coach_summaries WHERE activity_id = ?')
    .get(activityId) as { updated_at: string } | undefined;
  return {
    ...coachSummary,
    steadyPaceSecKm: pauseBreakdown.steadyPaceSecKm,
    steadyHeartRate: pauseBreakdown.steadyHeartRate,
    steadyCadence: pauseBreakdown.steadyCadence,
    steadyStanceTime: pauseBreakdown.steadyStanceTimeMs,
    pauseBreakdown,
    ...(stored?.updated_at ? { updatedAt: stored.updated_at } : {})
  };
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
