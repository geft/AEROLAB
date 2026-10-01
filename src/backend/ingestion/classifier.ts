import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { ActivityMetadata, ActivityRecord } from './csv-parser';
import { EconomyMetrics } from '../physiology/economy';
import { DetectedInterval, inferWorkoutPrescription } from './interval-detector';
import { getDefaultZones, getLt2TrainingBand, calculateZoneDistribution, recordDurationSeconds } from '../physiology/zones';
import { continuousRaceEffort } from './continuous-effort.js';

export type RunType = 'easy_base' | 'long_run' | 'threshold_lt2' | 'intervals_vo2' | 'race' | 'recovery';

export interface ClassificationResult {
  runType: RunType;
  confidence: number;
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
 * - Never uses pace/speed (absolute or relative) for classification, so slower
 *   athletes and improving fitness over time cannot skew results.
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
  const avgHr = metadata.avgHeartRate;

  const profileWithMeta = profile ?? (metadata.maxHeartRate && metadata.maxHeartRate >= 100 ? { maxHr: metadata.maxHeartRate } : undefined);
  const { maxHr: effMax, restingHr: resting, lt1Hr: lt1, lt2Hr: lt2 } = resolveHeartRateProfile(profileWithMeta);

  // Zone distribution from profile-relative zones (no hardcoded bpm anywhere).
  const zones = getDefaultZones(effMax, lt1, lt2, resting);
  const zoneDist = calculateZoneDistribution(records, zones);
  const lt2Anchor = lt2;
  const [thresholdHrFloor] = getLt2TrainingBand(lt2Anchor);
  // Zone 5 now means above LT2. Keep VO2 detection tied to the former
  // high-intensity HRR ceiling so threshold HR alone does not imply VO2 work.
  const vo2HrFloor = Math.min(effMax - 1, Math.max(lt2, Math.round(resting + (effMax - resting) * 0.90))) + 1;
  let validHrSeconds = 0;
  let vo2HrSeconds = 0;
  let thresholdHrSeconds = 0;
  for (let index = 0; index < records.length; index++) {
    const hr = records[index].heartRate;
    if (hr == null || !Number.isFinite(hr) || hr <= 40 || hr > 240) continue;
    const seconds = recordDurationSeconds(records, index);
    validHrSeconds += seconds;
    if (hr >= vo2HrFloor) vo2HrSeconds += seconds;
    if (hr >= thresholdHrFloor) thresholdHrSeconds += seconds;
  }
  const vo2HrPct = validHrSeconds > 0
    ? vo2HrSeconds / validHrSeconds * 100
    : 0;

  const workIntervals = detectedIntervals.filter(i => i.type === 'work');
  const qualityWorkIndexes = detectedIntervals.map((interval, index) => ({ interval, index })).filter(({ interval }) =>
    interval.type === 'work' && interval.durationSeconds >= 120 && interval.avgHeartRate >= thresholdHrFloor);
  const hasRepeatedQualityWork = qualityWorkIndexes.some((work, index) => {
    const previous = qualityWorkIndexes[index - 1];
    return previous && detectedIntervals.slice(previous.index + 1, work.index).some(interval =>
      interval.type === 'recovery' && interval.durationSeconds >= 30);
  });

  // Whole-session averages dilute a benchmark with its warmup/cooldown.
  // Evaluate sustained high-intensity bouts before threshold/interval rules.
  const raceEffort = continuousRaceEffort(records, { maxHr: effMax, restingHr: resting, lt2Hr: lt2 });
  if (raceEffort && !hasRepeatedQualityWork) {
    return {
      runType: 'race',
      confidence: 0.88,
      reason: `Continuous race-intensity effort (${(raceEffort.durationSeconds / 60).toFixed(1)}m above the threshold band, ${raceEffort.nearMaxPct.toFixed(0)}% at near-maximal cardiovascular intensity)`
    };
  }

  // 1b. Check for Galloway Run/Walk method
  // Galloway sessions have repeated scheduled walk breaks interspersed with easy running.
  // We identify:
  // - 4+ distinct walking recoveries or walking episodes (cadence < 125, duration >= 15s)
  // - Overall cardiovascular load is aerobic: avg HR near/below LT1, negligible Z4/Z5 (< 15%)
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

    const vo2RepCount = workIntervals.filter(i => i.maxHeartRate >= vo2HrFloor || i.maxHeartRate >= effMax * 0.91).length;
    const hasVo2Intensity = vo2RepCount >= 2 || (vo2RepCount >= 1 && vo2HrPct >= 4) || (vo2HrPct >= 6 && vo2HrSeconds >= 120);
    const isSporadicSurges =
      (totalWorkDurationSec < 300 || totalWorkDurationSec < metadata.totalDurationSeconds * 0.22) &&
      vo2RepCount < 2 && vo2HrPct < 4;
    const isVo2Intervals = !isSporadicSurges && workIntervals.length >= 2 && medianWorkSec <= 360 && hasVo2Intensity;

    const repInThresholdBand = (hr: number): boolean => hr >= thresholdHrFloor;
    const thresholdRepCount = workIntervals.filter(i =>
      repInThresholdBand(i.avgHeartRate)
    ).length;

    // A. Long Threshold Intervals: sustained structure (median work >= 6 min)
    //    with threshold-band HR occupancy (profile-relative).
    const isThresholdIntervals =
      (medianWorkSec >= 360 &&
        thresholdRepCount >= Math.max(1, Math.ceil(workIntervals.length / 2))) ||
      workIntervals.some(i => i.durationSeconds >= 450 && repInThresholdBand(i.avgHeartRate));

    if (isThresholdIntervals && !isVo2Intervals) {
      const isFailed = qualityWorkoutFailed('threshold_lt2', workIntervals, profileWithMeta);

      return {
        runType: 'threshold_lt2',
        confidence: 0.92,
        isFailedWorkout: isFailed,
        reason: isFailed
          ? `Threshold stimulus missed or cut short${prescLabel} (${workIntervals.length} rep(s), HR fade or below threshold band)`
          : `Detected ${workIntervals.length} threshold work intervals${prescLabel} (median ${(medianWorkSec / 60).toFixed(1)}m, threshold-band HR)`
      };
    }

    // B. VO2 Max Intervals: short repeated structure (median work <= 6 min,
    //    2+ reps) with Z5 spikes (profile-relative max-HR attainment).
    if (isVo2Intervals) {
      const isFailed = qualityWorkoutFailed('intervals_vo2', workIntervals, profileWithMeta);

      return {
        runType: 'intervals_vo2',
        confidence: 0.93,
        isFailedWorkout: isFailed,
        reason: isFailed
          ? `VO2 stimulus missed or cut short${prescLabel} (${workIntervals.length} rep(s), ${(totalWorkDurationSec / 60).toFixed(1)}m total work)`
          : `Detected ${workIntervals.length} VO2 work intervals${prescLabel} (median ${(medianWorkSec / 60).toFixed(1)}m, peak HR ${maxWorkHr})`
      };
    }
  }

  // Walking recoveries also occur in genuine quality sessions. Evaluate their
  // work bouts first so aerobic warmups cannot hide the interval stimulus.
  if (isGallowaySession) {
    return {
      runType: durationMin >= 110 ? 'long_run' : 'easy_base',
      confidence: 0.92,
      reason: `Aerobic base run with Galloway run/walk intervals (${gallowayWalkCount} walk breaks, avg HR ${avgHr} bpm)`
    };
  }

  // 3. Continuous Threshold / Tempo check (profile-relative zone occupancy)
  const thresholdHrPct = validHrSeconds > 0 ? thresholdHrSeconds / validHrSeconds * 100 : 0;
  if (thresholdHrPct >= 35) {
    return {
      runType: 'threshold_lt2',
      confidence: 0.88,
      reason: `Sustained lactate threshold tempo effort (${thresholdHrPct.toFixed(0)}% near or above the LT2 training band, profile-relative)`
    };
  }

  // 4. Long Run check (duration on feet only: >= 110 mins — pace-free)
  if (durationMin >= 110) {
    return {
      runType: 'long_run',
      confidence: 0.9,
      reason: `Extended endurance duration (${durationMin.toFixed(0)} mins on feet)`
    };
  }

  // 5. Recovery run check.
  // Short duration alone is not evidence of recovery intent: a run can be cut
  // short by schedule, weather, or air quality. For unnamed runs, require both
  // low average HR and most recorded time in the athlete-relative recovery zone.
  // Do not use a fraction of max HR here; for some athletes that labels steady
  // Zone 2 running as recovery, especially when a short session limits HR lag.
  const isRecoveryHr = avgHr <= zones.z1[1] && zoneDist.z1Pct >= 50;
  if (durationMin <= 50 && isRecoveryHr) {
    return {
      runType: 'recovery',
      confidence: 0.88,
      reason: `Very low cardiovascular strain recovery jog (${durationMin.toFixed(0)} min, avg HR ${avgHr} bpm, ${zoneDist.z1Pct.toFixed(0)}% in Zone 1)`
    };
  }

  // 6. Default to Easy / Aerobic base
  const hasSurges = workIntervals.length > 0;
  const isTempoZ3 = zoneDist.z3Pct >= 25 || (zoneDist.z3Pct + zoneDist.z4Pct >= 35);
  return {
    runType: 'easy_base',
    confidence: 0.9,
    reason: isTempoZ3
      ? `Aerobic tempo effort${hasSurges ? ' with surges' : ''} (avg HR ${avgHr} bpm, decoupling ${economy.aerobicDecouplingPct ?? 0}%)`
      : `Aerobic base effort${hasSurges ? ' with strides/surges' : ''} (avg HR ${avgHr} bpm, decoupling ${economy.aerobicDecouplingPct ?? 0}%)`
  };
}
