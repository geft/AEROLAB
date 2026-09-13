import { ActivityMetadata, ActivityRecord } from './csv-parser';
import { EconomyMetrics } from '../physiology/economy';
import { DetectedInterval } from './interval-detector';
import { getDefaultZones, calculateZoneDistribution } from '../physiology/zones';

export type RunType = 'easy_base' | 'long_run' | 'threshold_lt2' | 'intervals_vo2' | 'race' | 'recovery';

export interface ClassificationResult {
  runType: RunType;
  confidence: number;
  reason: string;
  isFailedWorkout?: boolean;
}

export function classifyRun(
  metadata: ActivityMetadata,
  records: ActivityRecord[],
  economy: EconomyMetrics,
  detectedIntervals: DetectedInterval[]
): ClassificationResult {
  const durationMin = metadata.totalDurationSeconds / 60;
  const distanceKm = metadata.totalDistanceMeters / 1000;
  const avgHr = metadata.avgHeartRate;
  const maxHr = metadata.maxHeartRate > 120 ? metadata.maxHeartRate : 185;
  const nameLower = (metadata.name || '').toLowerCase();

  // Zone distribution
  const zones = getDefaultZones(maxHr);
  const zoneDist = calculateZoneDistribution(records, zones);

  // 1. Race / Continuous Time Trial Detection
  //    Keywords: "time trial", "tt", "race", "parkrun", "marathon" (as a race effort)
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

  // 2. Failed / Aborted Workout check based on explicit name/notes
  const isExplicitlyFailed =
    nameLower.includes('failed') ||
    nameLower.includes('aborted') ||
    nameLower.includes('dnf') ||
    nameLower.includes('bailed');

  // 3. Evaluate Structured Work Intervals (Threshold vs VO2 Max vs Failed)
  if (workIntervals.length >= 1) {
    const totalWorkDurationSec = workIntervals.reduce((s, i) => s + i.durationSeconds, 0);
    const avgWorkDurationSec = totalWorkDurationSec / workIntervals.length;
    const avgWorkHr = workIntervals.reduce((s, i) => s + i.avgHeartRate, 0) / workIntervals.length;
    const maxWorkHr = Math.max(...workIntervals.map(i => i.maxHeartRate));

    // Evaluate pace decay between early reps and late reps
    let paceDegraded = false;
    if (workIntervals.length >= 3) {
      const firstRepPace = workIntervals[0].avgPaceSecKm;
      const lastRepPace = workIntervals[workIntervals.length - 1].avgPaceSecKm;
      if (firstRepPace > 0 && lastRepPace > firstRepPace * 1.20) {
        paceDegraded = true;
      }
    }

    // A. Long Threshold Intervals:
    //    User rule: Sustaining high BPM (Zone 4 / LT2: >= 165 bpm)
    //    for more than 8 minutes per interval (or average work duration >= 360s at threshold HR)
    const highBpmThreshold = 165;
    const hasLongThresholdIntervals = workIntervals.some(
      i => i.durationSeconds >= 450 && (i.avgHeartRate >= highBpmThreshold || i.maxHeartRate >= 170)
    );

    const isThresholdIntervals =
      hasLongThresholdIntervals ||
      (avgWorkDurationSec >= 360 && (avgWorkHr >= highBpmThreshold || zoneDist.z4Pct >= 30)) ||
      (nameLower.includes('threshold') && (avgWorkHr >= 160 || zoneDist.z4Pct >= 20));

    if (isThresholdIntervals) {
      const isFailed =
        isExplicitlyFailed ||
        (workIntervals.length === 1 && totalWorkDurationSec < 480) ||
        (workIntervals.length >= 2 && paceDegraded);

      return {
        runType: 'threshold_lt2',
        confidence: 0.92,
        isFailedWorkout: isFailed,
        reason: isFailed
          ? `Threshold workout aborted early or target duration compromised (${workIntervals.length} rep(s))`
          : `Detected ${workIntervals.length} threshold work intervals (avg ${(avgWorkDurationSec / 60).toFixed(1)}m sustained high BPM)`
      };
    }

    // B. VO2 Max Intervals:
    //    Work reps sustained for < 5 minutes (<= 300s) with high intensity / Zone 5 heart rate spikes
    const isVo2Intervals =
      (workIntervals.length >= 2 && avgWorkDurationSec <= 330 && (maxWorkHr >= maxHr * 0.85 || zoneDist.z5Pct >= 5 || avgWorkHr >= maxHr * 0.82)) ||
      nameLower.includes('vo2');

    if (isVo2Intervals) {
      const isFailed =
        isExplicitlyFailed ||
        workIntervals.length < 2 ||
        totalWorkDurationSec < 360 ||
        paceDegraded;

      return {
        runType: 'intervals_vo2',
        confidence: 0.93,
        isFailedWorkout: isFailed,
        reason: isFailed
          ? `VO2 workout aborted early or pace collapsed (${workIntervals.length} rep(s), ${(totalWorkDurationSec / 60).toFixed(1)}m total work)`
          : `Detected ${workIntervals.length} high-velocity VO2 work intervals (avg ${(avgWorkDurationSec / 60).toFixed(1)}m, max HR ${maxWorkHr})`
      };
    }
  }

  // 4. Continuous Threshold / Tempo check (significant sustained time in Zone 4)
  if (zoneDist.z4Pct >= 35 || (zoneDist.z4Pct + zoneDist.z5Pct >= 45)) {
    return {
      runType: 'threshold_lt2',
      confidence: 0.88,
      reason: `Sustained lactate threshold tempo effort (${zoneDist.z4Pct.toFixed(0)}% in Zone 4)`
    };
  }

  // 5. Long Run check (>= 75 mins or >= 16 km)
  if (durationMin >= 75 || distanceKm >= 16) {
    return {
      runType: 'long_run',
      confidence: 0.90,
      reason: `Extended endurance duration (${durationMin.toFixed(0)} mins, ${distanceKm.toFixed(1)} km)`
    };
  }

  // 6. Recovery run check (low cardiovascular strain: avg HR < 70% max HR and duration <= 40 min)
  const isRecoveryHr = maxHr > 0 ? avgHr < maxHr * 0.70 : avgHr < 128;
  if (durationMin <= 40 && isRecoveryHr) {
    return {
      runType: 'recovery',
      confidence: 0.88,
      reason: `Low cardiovascular strain recovery jog (${durationMin.toFixed(0)} min, avg HR ${avgHr})`
    };
  }

  // 7. Default to Easy / Aerobic base
  return {
    runType: 'easy_base',
    confidence: 0.90,
    reason: `Aerobic base pacing (avg HR ${avgHr}, decoupling ${economy.aerobicDecouplingPct ?? 0}%)`
  };
}
