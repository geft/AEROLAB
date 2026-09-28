import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { ActivityMetadata, ActivityRecord } from './csv-parser';
import { EconomyMetrics } from '../physiology/economy';
import { DetectedInterval, inferWorkoutPrescription } from './interval-detector';
import { getDefaultZones, calculateZoneDistribution } from '../physiology/zones';

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
  const nameLower = (metadata.name || '').toLowerCase();

  const profileWithMeta = profile ?? (metadata.maxHeartRate && metadata.maxHeartRate >= 100 ? { maxHr: metadata.maxHeartRate } : undefined);
  const { maxHr: effMax, restingHr: resting, lt1Hr: lt1, lt2Hr: lt2 } = resolveHeartRateProfile(profileWithMeta);

  // Zone distribution from profile-relative zones (no hardcoded bpm anywhere).
  const zones = getDefaultZones(effMax, lt1, lt2, resting);
  const zoneDist = calculateZoneDistribution(records, zones);
  const lt2Anchor = lt2;
  // Zone 5 now means above LT2. Keep VO2 detection tied to the former
  // high-intensity HRR ceiling so threshold HR alone does not imply VO2 work.
  const vo2HrFloor = Math.min(effMax - 1, Math.max(lt2, Math.round(resting + (effMax - resting) * 0.90))) + 1;
  const validHrRecords = records.filter(r => r.heartRate != null && r.heartRate > 40);
  const vo2HrPct = validHrRecords.length > 0
    ? (validHrRecords.filter(r => r.heartRate! >= vo2HrFloor).length / validHrRecords.length) * 100
    : 0;

  // 1. Race / Continuous Time Trial Detection (title-only, pace-free)
  const isRaceByName =
    nameLower.includes('time trial') ||
    nameLower.includes(' tt') ||
    nameLower.includes('race') ||
    nameLower.includes('parkrun');

  const workIntervals = detectedIntervals.filter(i => i.type === 'work');

  if (isRaceByName) {
    return {
      runType: 'race',
      confidence: 0.95,
      reason: `Race / Benchmark effort identified by activity title: "${metadata.name}"`
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
  for (const r of records) {
    const cad = r.cadence ?? 0;
    const spd = r.speedMps ?? 0;
    if (cad > 0 && cad < 125 && spd < 1.8) {
      walkStreak++;
      if (walkStreak >= 15 && !inWalk) {
        inWalk = true;
        recordWalkBouts++;
      }
    } else if (cad >= 128) {
      inWalk = false;
      walkStreak = 0;
    }
  }

  const gallowayWalkCount = Math.max(walkingBouts, recordWalkBouts);
  const isGallowaySession = gallowayWalkCount >= 4 &&
    (zoneDist.z5Pct < 15) &&
    (avgHr <= lt1 + 6 || (zoneDist.z1Pct + zoneDist.z2Pct >= 50));

  if (isGallowaySession) {
    const isLong = durationMin >= 100;
    return {
      runType: isLong ? 'long_run' : 'easy_base',
      confidence: 0.92,
      reason: `Aerobic base run with Galloway run/walk intervals (${gallowayWalkCount} walk breaks, avg HR ${avgHr} bpm)`
    };
  }

  // 2. Evaluate Structured Work Intervals (Threshold vs VO2 Max vs Failed)
  //    Structure = rep count + work/recovery durations + regularity.
  //    Intensity = profile-relative HR zone occupancy.
  if (workIntervals.length >= 1) {
    const totalWorkDurationSec = workIntervals.reduce((s, i) => s + i.durationSeconds, 0);
    const sortedWork = [...workIntervals]
      .map(i => i.durationSeconds)
      .sort((a, b) => a - b);
    const medianWorkSec = sortedWork[Math.floor(sortedWork.length / 2)];
    const avgWorkDurationSec = totalWorkDurationSec / workIntervals.length;
    const maxWorkHr = Math.max(...workIntervals.map(i => i.maxHeartRate));

    const prescription = inferWorkoutPrescription(detectedIntervals);
    const prescLabel = prescription ? ` (${prescription.label})` : '';

    // HR fade across reps (late-rep peak HR drops while structure holds) — no pace.
    let hrFade = false;
    if (workIntervals.length >= 3) {
      const peaks = workIntervals.map(i => i.maxHeartRate).filter(h => h > 0);
      if (peaks.length >= 3) {
        const half = Math.floor(peaks.length / 2);
        const early = peaks.slice(0, half).reduce((a, b) => a + b, 0) / half;
        const late = peaks.slice(-half).reduce((a, b) => a + b, 0) / half;
        if (early - late >= 8) hrFade = true;
      }
    }

    const repInThresholdBand = (hr: number): boolean => hr >= lt2Anchor - 8;
    const thresholdRepCount = workIntervals.filter(i =>
      repInThresholdBand(i.avgHeartRate)
    ).length;

    // A. Long Threshold Intervals: sustained structure (median work >= 6 min)
    //    with threshold-band HR occupancy (profile-relative).
    const isThresholdIntervals =
      (medianWorkSec >= 360 &&
        (thresholdRepCount >= Math.max(1, Math.ceil(workIntervals.length / 2)) ||
          zoneDist.z4Pct >= 25)) ||
      workIntervals.some(i => i.durationSeconds >= 450 && repInThresholdBand(i.avgHeartRate));

    if (isThresholdIntervals) {
        const stimulusMissed = maxWorkHr < lt2Anchor - 8;
      const isFailed =
        stimulusMissed ||
        (workIntervals.length === 1 && totalWorkDurationSec < 480) ||
        hrFade;

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
    const vo2RepCount = workIntervals.filter(i => i.maxHeartRate >= vo2HrFloor || i.maxHeartRate >= effMax * 0.91).length;
    const vo2HrSamples = validHrRecords.filter(r => r.heartRate! >= vo2HrFloor).length;
    const hasVo2Intensity = vo2RepCount >= 2 || (vo2RepCount >= 1 && vo2HrPct >= 4) || (vo2HrPct >= 6 && vo2HrSamples >= 120);
    const hasExplicitVo2 = nameLower.includes('vo2') || nameLower.includes('v02');

    // Surges check: If work intervals are sporadic brief bursts in a steady tempo/base run,
    // do not classify as VO2 max without explicit VO2 name or actual sustained VO2 intensity.
    const isSporadicSurges =
      !hasExplicitVo2 &&
      (totalWorkDurationSec < 300 || totalWorkDurationSec < metadata.totalDurationSeconds * 0.22) &&
      vo2RepCount < 2 &&
      vo2HrPct < 4;

    const isVo2Intervals =
      !isSporadicSurges &&
      workIntervals.length >= 2 &&
      medianWorkSec <= 360 &&
      (hasExplicitVo2 || hasVo2Intensity);

    if (isVo2Intervals) {
      const stimulusMissed = maxWorkHr < lt2Anchor - 6;
      const isFailed =
        stimulusMissed ||
        totalWorkDurationSec < 360 ||
        hrFade;

      return {
        runType: 'intervals_vo2',
        confidence: 0.93,
        isFailedWorkout: isFailed,
        reason: isFailed
          ? `VO2 stimulus missed or cut short${prescLabel} (${workIntervals.length} rep(s), ${(totalWorkDurationSec / 60).toFixed(1)}m total work)`
          : `Detected ${workIntervals.length} VO2 work intervals${prescLabel} (median ${(medianWorkSec / 60).toFixed(1)}m, peak HR ${maxWorkHr})`
      };
    }

    void avgWorkDurationSec;
  }

  // 3. Continuous Threshold / Tempo check (profile-relative zone occupancy)
  if (zoneDist.z4Pct >= 35 || zoneDist.z5Pct >= 45) {
    return {
      runType: 'threshold_lt2',
      confidence: 0.88,
      reason: `Sustained lactate threshold tempo effort (${zoneDist.z4Pct.toFixed(0)}% in Zone 4, profile-relative)`
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
  const isExplicitRecovery = nameLower.includes('recovery');
  const isRecoveryHr = avgHr <= zones.z1[1] && zoneDist.z1Pct >= 50;
  if (isExplicitRecovery || (durationMin <= 50 && isRecoveryHr)) {
    return {
      runType: 'recovery',
      confidence: 0.88,
      reason: isExplicitRecovery
        ? `Recovery run identified by title: "${metadata.name}"`
        : `Very low cardiovascular strain recovery jog (${durationMin.toFixed(0)} min, avg HR ${avgHr} bpm, ${zoneDist.z1Pct.toFixed(0)}% in Zone 1)`
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
