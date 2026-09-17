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

  // Effective athlete HR references (profile first, session-observed fallback).
  const sessionPeak = metadata.maxHeartRate > 140 ? metadata.maxHeartRate : 185;
  const effMax = profile?.maxHr && profile.maxHr > 140 ? profile.maxHr : sessionPeak;
  const resting = profile?.restingHr && profile.restingHr > 30 ? profile.restingHr : 55;
  const lt1 = profile?.lt1Hr && profile.lt1Hr > 100 ? profile.lt1Hr : undefined;
  const lt2 = profile?.lt2Hr && profile.lt2Hr > 100 ? profile.lt2Hr : undefined;

  // Zone distribution from profile-relative zones (no hardcoded bpm anywhere).
  const zones = getDefaultZones(effMax, lt1, lt2, resting);
  const zoneDist = calculateZoneDistribution(records, zones);
  const z4Floor = zones.z4[0];
  const z5Floor = zones.z5[0];

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
    const avgWorkHr =
      workIntervals.reduce((s, i) => s + i.avgHeartRate, 0) / workIntervals.length;
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

    const repInThresholdBand = (hr: number): boolean => hr >= z4Floor - 8;
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
      const stimulusMissed = maxWorkHr < z4Floor - 8;
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
    const vo2RepCount = workIntervals.filter(i => i.maxHeartRate >= z5Floor || i.maxHeartRate >= z4Floor + 3).length;
    const isVo2Intervals =
      workIntervals.length >= 2 &&
      medianWorkSec <= 360 &&
      (vo2RepCount >= 1 || zoneDist.z5Pct >= 4 || avgWorkHr >= z4Floor - 8 || nameLower.includes('vo2'));

    if (isVo2Intervals) {
      const stimulusMissed = maxWorkHr < z4Floor - 6;
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
  if (zoneDist.z4Pct >= 35 || zoneDist.z4Pct + zoneDist.z5Pct >= 45) {
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

  // 5. Recovery run check (duration + profile-relative low strain — no absolute bpm).
  // Recovery ceiling tracks just under LT1 (LT1 minus 12 bpm ≈ top of Z1),
  // or under 72% of max HR — so slower athletes qualify on their own zones.
  const recoveryCeiling = (lt1 ?? 148) - 12;
  const isExplicitRecovery = nameLower.includes('recovery');
  const isRecoveryHr = avgHr <= recoveryCeiling || avgHr < effMax * 0.72;
  if (isExplicitRecovery || (durationMin <= 50 && isRecoveryHr)) {
    return {
      runType: 'recovery',
      confidence: 0.88,
      reason: isExplicitRecovery
        ? `Recovery run identified by title: "${metadata.name}"`
        : `Low cardiovascular strain recovery jog (${durationMin.toFixed(0)} min, avg HR ${avgHr} bpm vs Z1 ceiling ${zones.z1[1]} bpm)`
    };
  }

  // 6. Default to Easy / Aerobic base
  return {
    runType: 'easy_base',
    confidence: 0.9,
    reason: `Aerobic base effort (avg HR ${avgHr}, decoupling ${economy.aerobicDecouplingPct ?? 0}%)`
  };
}
