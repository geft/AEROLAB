import type { ClassificationEvidence, ClassificationRuleId } from '../../shared/contracts/classification.js';
import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { ActivityMetadata, ActivityRecord } from './csv-parser';
import { createRunningHrExposureCalculator, EconomyMetrics } from '../physiology/economy';
import { DetectedInterval, inferWorkoutPrescription } from './interval-detector';
import { getDefaultZones, getLt2TrainingBand, calculateZoneDistribution, recordDurationSeconds } from '../physiology/zones';
import { continuousRaceEffort } from './continuous-effort.js';
import { timeWeightedMean } from '../physiology/time-series.js';

export type RunType = 'easy_base' | 'long_run' | 'tempo' | 'threshold_lt2' | 'intervals_vo2' | 'race' | 'recovery';

/** Endurance-dose default; intensity-based workout rules retain precedence. */
export const LONG_RUN_MIN_SECONDS = 100 * 60;
/** Conservative stimulus support; peaks and recovery HR cannot certify work. */
export const CLASSIFICATION_TELEMETRY_POLICY = {
  minHrCoverage: 0.60, minContinuousSeconds: 120, continuousThresholdPct: 35,
  minVo2Seconds: 20, minVo2Pct: 20, minVo2StreakSeconds: 15,
  longVo2Seconds: 120, longVo2Pct: 25, longVo2MaxRepSeconds: 600,
  thresholdRepPct: 50, thresholdMeanTolerance: 0.5, thresholdMeanMinPct: 25,
  summaryHrDisagreement: 8,
  tempoRepMinSeconds: 90, tempoRepMinTotalSeconds: 300, tempoRepSharePct: 25,
  tempoRepLt1MarginBpm: 2
} as const;

export interface ClassificationResult {
  runType: RunType;
  confidence: number;
  evidence: ClassificationEvidence;
  reason: string;
  isFailedWorkout?: boolean;
}

export interface AthleteHrProfile {
  maxHr?: number | null;
  restingHr?: number | null;
  lt1Hr?: number | null;
  lt2Hr?: number | null;
}

/** The same quality-session failure evidence is used by import and coaching. */
export function qualityWorkoutFailed(
  runType: string,
  workIntervals: Pick<DetectedInterval, 'durationSeconds' | 'maxHeartRate'>[],
  profile?: AthleteHrProfile
): boolean {
  if (!['threshold_lt2', 'intervals_vo2'].includes(runType) || workIntervals.length === 0) return false;
  const totalWork = workIntervals.reduce((sum, interval) => sum + interval.durationSeconds, 0);
  const peaks = workIntervals.map(interval => interval.maxHeartRate).filter(hr => hr > 40 && Number.isFinite(hr));
  const { lt2Hr } = resolveHeartRateProfile(profile);
  const missedStimulus = peaks.length > 0 && Math.max(...peaks) < lt2Hr - (runType === 'threshold_lt2' ? 8 : 6);
  let hrFade = false;
  if (peaks.length >= 3) {
    const half = Math.floor(peaks.length / 2);
    const early = peaks.slice(0, half).reduce((sum, hr) => sum + hr, 0) / half;
    const late = peaks.slice(-half).reduce((sum, hr) => sum + hr, 0) / half;
    hrFade = early - late >= 8;
  }
  return missedStimulus || hrFade || (runType === 'intervals_vo2'
    ? totalWork < 360 : workIntervals.length === 1 && totalWork < 480);
}

/**
 * Pace-free workout classifier.
 *
 * Rules:
 * - Quality intensity uses HR, not pace. Upstream segmentation uses within-run
 *   speed contrast; walking detection below uses cadence and walking speed.
 *   Neither uses a fixed training pace to distinguish threshold from VO2.
 * - Intervals are defined by structure (rep count, work/recovery durations,
 *   regularity) + heart rate relative to the athlete profile (LT1/LT2/max,
 *   never hardcoded bpm).
 * - Failed-workout detection is HR + structure only (volume shortfall, missed
 *   stimulus, HR fade) — no pace-decay checks, no title keywords.
 */
export function classifyRun(
  metadata: ActivityMetadata,
  records: ActivityRecord[],
  economy: EconomyMetrics,
  detectedIntervals: DetectedInterval[],
  profile?: AthleteHrProfile
): ClassificationResult {
  const durationMin = metadata.totalDurationSeconds / 60;
  const avgHr = records.some(record => (record.timerPauseSeconds ?? 0) > 0)
    ? timeWeightedMean(records, r => r.elapsedSeconds, r => r.heartRate, hr => hr > 40 && hr <= 240) ?? metadata.avgHeartRate
    : metadata.avgHeartRate;

  const profileWithMeta = profile ?? (metadata.maxHeartRate && metadata.maxHeartRate >= 100 ? { maxHr: metadata.maxHeartRate } : undefined);
  const { maxHr: effMax, restingHr: resting, lt1Hr: lt1, lt2Hr: lt2 } = resolveHeartRateProfile(profileWithMeta);

  // Zone boundaries come from the athlete profile; HR validity limits below
  // reject implausible sensor readings rather than set training intensity.
  const zones = getDefaultZones(effMax, lt1, lt2, resting);
  const zoneDist = calculateZoneDistribution(records, zones);
  const lt2Anchor = lt2;
  const [thresholdHrFloor, thresholdHrCeiling] = getLt2TrainingBand(lt2Anchor);
  // Require HR above both the LT2 training band and the high-intensity HRR
  // ceiling so threshold-band effort alone does not imply VO2 work.
  const vo2HrFloor = Math.max(thresholdHrCeiling + 1,
    Math.min(effMax, Math.round(resting + (effMax - resting) * 0.90) + 1));
  // High LT2/max-HR ratios are valid individual profiles. A max-HR fraction
  // must never bypass the athlete's threshold band and relabel it as VO2.
  const nearMaxVo2Floor = Math.max(effMax * 0.91, thresholdHrCeiling + 1);
  const exposureFor = createRunningHrExposureCalculator(records);
  const running = exposureFor(vo2HrFloor, thresholdHrFloor);
  const { validHrSeconds, aboveCeilingSeconds: vo2HrSeconds, atOrAboveLt1Seconds: thresholdHrSeconds } = running;
  const hrCoverage = running.runningSeconds > 0 ? validHrSeconds / running.runningSeconds : 0;
  const policy = CLASSIFICATION_TELEMETRY_POLICY;
  const intensityObserved = hrCoverage >= policy.minHrCoverage && validHrSeconds >= policy.minContinuousSeconds;
  const vo2HrPct = validHrSeconds > 0
    ? vo2HrSeconds / validHrSeconds * 100
    : 0;

  const workIntervals = detectedIntervals.filter(i => i.type === 'work');
  const repExposure = new Map(workIntervals.map(interval => [interval,
    exposureFor(Math.min(vo2HrFloor, nearMaxVo2Floor), thresholdHrFloor,
      interval.startSeconds, interval.startSeconds + interval.durationSeconds)]));
  const repCovered = (interval: DetectedInterval) => repExposure.get(interval)!.validHrSeconds >= interval.durationSeconds * policy.minHrCoverage;
  const thresholdRep = (interval: DetectedInterval) => {
    const rep = repExposure.get(interval)!;
    return repCovered(interval) && ((rep.atOrAboveLt1Pct ?? 0) >= policy.thresholdRepPct ||
      ((rep.avgHr ?? 0) >= thresholdHrFloor - policy.thresholdMeanTolerance &&
        (rep.atOrAboveLt1Pct ?? 0) >= policy.thresholdMeanMinPct));
  };
  // Tempo reps sit above LT1 but below the threshold band. A single long block
  // is handled by the structured_tempo rule; repeated shorter reps need their
  // own evidence so a fartlek-style session is not filed as an easy run.
  const tempoRep = (interval: DetectedInterval) => {
    const rep = repExposure.get(interval)!;
    const meanHr = rep.avgHr ?? 0;
    return repCovered(interval) && interval.durationSeconds >= policy.tempoRepMinSeconds &&
      meanHr > lt1 + policy.tempoRepLt1MarginBpm && meanHr < thresholdHrFloor;
  };
  const tempoReps = workIntervals.filter(tempoRep);
  const tempoRepSeconds = tempoReps.reduce((sum, interval) => sum + interval.durationSeconds, 0);
  const qualityWorkIndexes = detectedIntervals.map((interval, index) => ({ interval, index })).filter(({ interval }) =>
    interval.type === 'work' && interval.durationSeconds >= 120 && thresholdRep(interval));
  const hasRepeatedQualityWork = qualityWorkIndexes.some((work, index) => {
    const previous = qualityWorkIndexes[index - 1];
    return previous && detectedIntervals.slice(previous.index + 1, work.index).some(interval =>
      interval.type === 'recovery' && interval.durationSeconds >= 30);
  });

  const supportedRepCount = workIntervals.filter(thresholdRep).length;
  const workHrSeconds = workIntervals.reduce((sum, interval) => sum + repExposure.get(interval)!.validHrSeconds, 0);
  const totalWorkSeconds = workIntervals.reduce((sum, interval) => sum + interval.durationSeconds, 0);
  const contradictoryRepCount = workIntervals.filter(interval => repCovered(interval) &&
    Math.abs((repExposure.get(interval)!.avgHr ?? interval.avgHeartRate) - interval.avgHeartRate) >= policy.summaryHrDisagreement).length;
  const movementCoverage = running.observedSeconds > 0 ? running.movementSeconds / running.observedSeconds : 0;
  const observedCoverage = Math.min(1, running.observedSeconds / Math.max(1, metadata.totalDurationSeconds));
  const result = (ruleId: ClassificationRuleId, classification: Omit<ClassificationResult, 'evidence'>,
    additional: Record<string, number | null> = {}): ClassificationResult => {
    const structured = ruleId === 'structured_threshold' || ruleId === 'structured_vo2' || ruleId === 'structured_tempo';
    const supported = ruleId === 'structured_tempo' ? tempoReps.length : supportedRepCount;
    const support = structured ? supported / Math.max(1, workIntervals.length) : 1;
    const coverage = structured ? Math.min(1, workHrSeconds / Math.max(1, totalWorkSeconds)) : hrCoverage;
    const confidence = Number((classification.confidence * (0.55 + 0.45 * coverage) *
      (0.8 + 0.2 * movementCoverage) * (0.8 + 0.2 * observedCoverage) * (0.9 + 0.1 * support) *
      (running.speedFallbackSeconds > 0 ? 0.95 : 1) *
      (1 - 0.15 * contradictoryRepCount / Math.max(1, workIntervals.length))).toFixed(3));
    return {
      ...classification,
      confidence,
      evidence: { ruleId, confidence: { kind: 'heuristic', score: confidence },
        measurements: { durationSeconds: metadata.totalDurationSeconds, avgHr, validHrSeconds, vo2HrPct,
          thresholdHrPct: validHrSeconds > 0 ? thresholdHrSeconds / validHrSeconds * 100 : 0,
          runningSeconds: running.runningSeconds, runningAvgHr: running.avgHr, hrCoverage, movementCoverage, observedCoverage,
          speedFallbackSeconds: running.speedFallbackSeconds, supportedRepCount, contradictoryRepCount, workHrSeconds,
          workVo2Seconds: workIntervals.reduce((sum, interval) => sum + repExposure.get(interval)!.aboveCeilingSeconds, 0),
          ...Object.fromEntries(workIntervals.flatMap((interval, index) => {
            const rep = repExposure.get(interval)!;
            return [[`rep${index + 1}HrSeconds`, rep.validHrSeconds], [`rep${index + 1}MeanHr`, rep.avgHr], [`rep${index + 1}ThresholdSeconds`, rep.atOrAboveLt1Seconds],
              [`rep${index + 1}Vo2Seconds`, rep.aboveCeilingSeconds], [`rep${index + 1}Vo2StreakSeconds`, rep.longestAboveCeilingSeconds]];
          })),
          workCount: workIntervals.length, workSeconds: workIntervals.reduce((sum, interval) => sum + interval.durationSeconds, 0), ...additional },
        policy: { maxHr: effMax, restingHr: resting, lt1Hr: lt1, lt2Hr: lt2,
          thresholdHrFloor, thresholdHrCeiling, vo2HrFloor, nearMaxVo2Floor, ...policy }
      }
    };
  };

  // Whole-session averages dilute a benchmark with its warmup/cooldown.
  // Evaluate sustained high-intensity bouts before threshold/interval rules.
  const raceEffort = continuousRaceEffort(records, { maxHr: effMax, restingHr: resting, lt2Hr: lt2 });
  if (raceEffort && !hasRepeatedQualityWork) {
    return result('continuous_race', {
      runType: 'race',
      confidence: 0.88,
      reason: `Continuous race-intensity effort (${(raceEffort.durationSeconds / 60).toFixed(1)}m above the threshold band, ${raceEffort.nearMaxPct.toFixed(0)}% at near-maximal cardiovascular intensity)`
    });
  }

  // 1b. Check for Galloway Run/Walk method
  // Galloway sessions have repeated scheduled walk breaks interspersed with easy running.
  // We identify:
  // - 4+ sustained walking episodes or low-cadence/slow recovery intervals
  // - Aerobic HR evidence with less than 15% Zone 5 exposure
  const walkingBouts = detectedIntervals.filter(
    i => i.type === 'recovery' && (i.avgCadence < 128 || i.avgSpeedMps < 1.8) && i.durationSeconds >= 15
  ).length;

  let recordWalkBouts = 0;
  let inWalk = false;
  let walkStreak = 0;
  for (let index = 0; index < records.length; index++) {
    const r = records[index];
    const cad = r.cadence ?? 0;
    const spd = r.speedMps ?? 0;
    if (cad > 0 && cad < 125 && spd < 1.8) {
      walkStreak += recordDurationSeconds(records, index);
      if (walkStreak >= 15 && !inWalk) {
        inWalk = true;
        recordWalkBouts++;
      }
    } else {
      inWalk = false;
      walkStreak = 0;
    }
  }

  const gallowayWalkCount = Math.max(walkingBouts, recordWalkBouts);
  const isGallowaySession = gallowayWalkCount >= 4 &&
    (zoneDist.z5Pct < 15) &&
    (avgHr <= lt1 + 6 || (zoneDist.z1Pct + zoneDist.z2Pct >= 50));

  // 2. Evaluate Structured Work Intervals (Threshold vs VO2 Max vs Failed)
  //    Structure = rep count + work/recovery durations + regularity.
  //    Intensity = profile-relative HR zone occupancy.
  if (workIntervals.length >= 1) {
    const totalWorkDurationSec = workIntervals.reduce((s, i) => s + i.durationSeconds, 0);
    const sortedWork = [...workIntervals]
      .map(i => i.durationSeconds)
      .sort((a, b) => a - b);
    const medianWorkSec = sortedWork[Math.floor(sortedWork.length / 2)];
    const maxWorkHr = Math.max(...workIntervals.map(i => i.maxHeartRate));

    const prescription = inferWorkoutPrescription(detectedIntervals);
    const prescLabel = prescription ? ` (${prescription.label})` : '';

    const vo2Rep = (interval: DetectedInterval) => {
      const rep = repExposure.get(interval)!;
      return repCovered(interval) && rep.aboveCeilingSeconds >= policy.minVo2Seconds &&
        rep.aboveCeilingSeconds >= interval.durationSeconds * policy.minVo2Pct / 100 &&
        rep.longestAboveCeilingSeconds >= policy.minVo2StreakSeconds;
    };
    const vo2RepCount = workIntervals.filter(vo2Rep).length;
    const hasVo2Intensity = vo2RepCount >= 2;
    // Distance-based or slower VO2 reps can exceed six minutes. Require sustained
    // near-max HR in two separate reps for this exception; peaks alone are not
    // enough to turn long threshold work into VO2. No training pace is involved.
    const sustainedVo2Reps = workIntervals.filter(interval => {
      // Prolonged threshold bouts can drift toward max HR too. Keep the
      // exception within interval-length efforts, not 15–20 minute blocks.
      if (interval.durationSeconds > policy.longVo2MaxRepSeconds || !vo2Rep(interval)) return false;
      const highSeconds = repExposure.get(interval)!.aboveCeilingSeconds;
      return highSeconds >= policy.longVo2Seconds && highSeconds >= interval.durationSeconds * policy.longVo2Pct / 100;
    });
    const hasSustainedVo2Structure = sustainedVo2Reps.length >= 2 && hasRepeatedQualityWork;
    const isSporadicSurges =
      (totalWorkDurationSec < 300 || totalWorkDurationSec < metadata.totalDurationSeconds * 0.22) &&
      vo2RepCount < 2 && vo2HrPct < 4;
    const isVo2Intervals = !isSporadicSurges && workIntervals.length >= 2 &&
      ((medianWorkSec <= 360 && hasVo2Intensity) || hasSustainedVo2Structure);

    const thresholdRepCount = workIntervals.filter(thresholdRep).length;

    // A. Long Threshold Intervals: sustained structure (median work >= 6 min)
    //    with threshold-band HR occupancy (profile-relative).
    const isThresholdIntervals =
      (medianWorkSec >= 360 &&
        thresholdRepCount >= Math.max(1, Math.ceil(workIntervals.length / 2))) ||
      workIntervals.some(i => i.durationSeconds >= 450 && thresholdRep(i));

    if (isThresholdIntervals && !isVo2Intervals) {
      const isFailed = qualityWorkoutFailed('threshold_lt2', workIntervals, profileWithMeta);

      return result('structured_threshold', {
        runType: 'threshold_lt2',
        confidence: 0.92,
        isFailedWorkout: isFailed,
        reason: isFailed
          ? `Threshold stimulus missed or cut short${prescLabel} (${workIntervals.length} rep(s), HR fade or below threshold band)`
          : `Detected ${workIntervals.length} threshold work intervals${prescLabel} (median ${(medianWorkSec / 60).toFixed(1)}m, threshold-band HR)`
      });
    }

    // B. VO2 Max Intervals: short repeated structure with max-HR attainment,
    //    or longer repeated bouts with sustained near-max HR evidence.
    if (isVo2Intervals) {
      const isFailed = qualityWorkoutFailed('intervals_vo2', workIntervals, profileWithMeta);

      return result('structured_vo2', {
        runType: 'intervals_vo2',
        confidence: 0.93,
        isFailedWorkout: isFailed,
        reason: isFailed
          ? `VO2 stimulus missed or cut short${prescLabel} (${workIntervals.length} rep(s), ${(totalWorkDurationSec / 60).toFixed(1)}m total work)`
          : `Detected ${workIntervals.length} VO2 work intervals${prescLabel} (median ${(medianWorkSec / 60).toFixed(1)}m, peak HR ${maxWorkHr})`
      });
    }
  }

  // 3. Continuous Threshold / Tempo check (profile-relative zone occupancy)
  const thresholdHrPct = validHrSeconds > 0 ? thresholdHrSeconds / validHrSeconds * 100 : 0;
  if (intensityObserved && thresholdHrPct >= policy.continuousThresholdPct) {
    return result('continuous_threshold', {
      runType: 'threshold_lt2',
      confidence: 0.88,
      reason: `Sustained lactate threshold tempo effort (${thresholdHrPct.toFixed(0)}% near or above the LT2 training band, profile-relative)`
    });
  }

  // Sustained upper-aerobic work can be diluted by easy warmup/cooldown.
  // Require a substantial work block, not isolated surges or duration alone.
  if (tempoReps.length >= 2 && tempoRepSeconds >= policy.tempoRepMinTotalSeconds &&
      validHrSeconds > 0 && tempoRepSeconds >= validHrSeconds * policy.tempoRepSharePct / 100) {
    return result('structured_tempo', {
      runType: 'tempo', confidence: 0.86,
      reason: `Repeated upper-aerobic tempo work (${tempoReps.length} reps, ${(tempoRepSeconds / 60).toFixed(0)} mins above LT1 and below the LT2 training band)`
    }, { tempoWorkSeconds: tempoRepSeconds });
  }
  const tempoWorkSeconds = workIntervals.filter(interval => interval.durationSeconds >= 1200 && repCovered(interval) &&
    (repExposure.get(interval)!.avgHr ?? 0) > lt1 && (repExposure.get(interval)!.avgHr ?? Infinity) < thresholdHrFloor)
    .reduce((sum, interval) => sum + interval.durationSeconds, 0);
  if (tempoWorkSeconds >= metadata.totalDurationSeconds * 0.25 && tempoWorkSeconds > 0) {
    return result('structured_tempo', {
      runType: 'tempo', confidence: 0.88,
      reason: `Sustained upper-aerobic tempo work (${(tempoWorkSeconds / 60).toFixed(0)} mins above LT1 and below the LT2 training band)`
    }, { tempoWorkSeconds });
  }

  // Walking recoveries also occur in genuine quality sessions. Evaluate their
  // work bouts first so easy warmups and walk breaks cannot hide tempo work.
  if (isGallowaySession) {
    return result('aerobic_run_walk', {
      runType: metadata.totalDurationSeconds >= LONG_RUN_MIN_SECONDS ? 'long_run' : 'easy_base',
      confidence: 0.92,
      reason: `Aerobic base run with Galloway run/walk intervals (${gallowayWalkCount} walk breaks, avg HR ${avgHr} bpm)`
    });
  }

  // 4. Long Run check (active duration: >= 100 mins — pace-free)
  if (metadata.totalDurationSeconds >= LONG_RUN_MIN_SECONDS) {
    return result('long_duration', {
      runType: 'long_run',
      confidence: 0.9,
      reason: `Extended endurance duration (${durationMin.toFixed(0)} mins on feet)`
    });
  }

  // 5. Recovery run check.
  // Recovery depends on dose and negligible intensity, not Zone 1 occupancy.
  // Use observed running evidence so walking/stops cannot lower average HR.
  const recoveryCeilingHr = resting + (effMax - resting) * 0.60;
  const recovery = exposureFor(recoveryCeilingHr, lt1);
  const avgHrrPct = recovery.avgHr == null ? null : (recovery.avgHr - resting) / (effMax - resting) * 100;
  if (intensityObserved && recovery.runningSeconds > 0 && recovery.runningSeconds <= 50 * 60 &&
      avgHrrPct != null && avgHrrPct <= 60 &&
      recovery.aboveCeilingPct != null && recovery.aboveCeilingPct <= 10 &&
      recovery.atOrAboveLt1Pct != null && recovery.atOrAboveLt1Pct <= 1) {
    return result('low_hrr_recovery', {
      runType: 'recovery',
      confidence: 0.88,
      reason: `Very low cardiovascular strain recovery jog (${(recovery.runningSeconds / 60).toFixed(0)} min running, ${avgHrrPct.toFixed(1)}% avg HRR, ${recovery.aboveCeilingPct.toFixed(1)}% above 60% HRR, ${recovery.atOrAboveLt1Pct.toFixed(1)}% at or above LT1)`
    });
  }

  // 6. Default to Easy / Aerobic base
  const hasSurges = workIntervals.length > 0;
  const isTempoZ3 = zoneDist.z3Pct >= 25 || (zoneDist.z3Pct + zoneDist.z4Pct >= 35);
  return result('aerobic_default', {
    runType: 'easy_base',
    confidence: 0.9,
    reason: isTempoZ3
      ? `Aerobic tempo effort${hasSurges ? ' with surges' : ''} (avg HR ${avgHr} bpm, decoupling ${economy.aerobicDecouplingPct ?? 0}%)`
      : `Aerobic base effort${hasSurges ? ' with strides/surges' : ''} (avg HR ${avgHr} bpm, decoupling ${economy.aerobicDecouplingPct ?? 0}%)`
  });
}
