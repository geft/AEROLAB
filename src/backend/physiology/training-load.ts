import { MAX_OBSERVED_GAP_SECONDS } from './time-series.js';
import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { getDefaultZones } from './zones.js';
/**
 * AEROLAB Physiological Training Load & ACWR Engine
 *
 * Computes Banister's cardiac impulse (TRIMP), scaled into relative load units
 * to calculate per-activity Training Load, 7-Day Acute Load (Fatigue), 28-Day Chronic Load
 * (Fitness Baseline), and the Optimal Training Load Tunnel (ACWR) for Garmin 165 users.
 */

import Database from 'better-sqlite3';

export interface HrProfile {
  maxHr: number;
  restingHr: number;
  lt1Hr?: number | null;
  lt2Hr?: number | null;
  gender?: string | null;
}

export interface ActivityLoadResult {
  trainingLoad: number;
  zones: {
    z1Seconds: number;
    z2Seconds: number;
    z3Seconds: number;
    z4Seconds: number;
    z5Seconds: number;
  };
}

export type TrainingStatusType = 'optimal' | 'recovery' | 'overreaching' | 'very_high' | 'maintaining' | 'establishing';

export interface DayLoadPoint {
  date: string; // YYYY-MM-DD
  dailyLoad: number;
  acuteLoad: number;
  chronicLoad: number;
  optimalMin: number;
  optimalMax: number;
  acwr: number;
}

export interface TrainingStatusResult {
  currentAcuteLoad: number;
  currentChronicLoad: number;
  acwr: number;
  status: TrainingStatusType;
  statusLabel: string;
  statusDescription: string;
  optimalRange: {
    min: number;
    max: number;
  };
  last7DaysLoad: number;
  timeline: DayLoadPoint[];
}

/**
 * Calculates per-activity scaled TRIMP and zone duration breakdown.
 */
export function calculateActivityTrainingLoad(
  records: Array<{ elapsed_seconds?: number | null; elapsedSeconds?: number | null; heart_rate?: number | null; heartRate?: number | null }>,
  hrProfile: HrProfile,
  fallbackSummary?: { durationSeconds?: number | null; avgHeartRate?: number | null }
): ActivityLoadResult {
  const { maxHr, restingHr, lt1Hr, lt2Hr } = resolveHeartRateProfile(hrProfile);
  const hrReserve = maxHr - restingHr;
  const boundaries = getDefaultZones(maxHr, lt1Hr, lt2Hr, restingHr);

  const isFemale = hrProfile.gender?.toLowerCase() === 'female';
  const expMultiplier = isFemale ? 1.67 : 1.92;
  const genderFactor = isFemale ? 0.86 : 0.64;

  let accumulatedTrimp = 0;
  let z1Sec = 0;
  let z2Sec = 0;
  let z3Sec = 0;
  let z4Sec = 0;
  let z5Sec = 0;

  if (records && records.length > 1) {
    for (let i = 1; i < records.length; i++) {
      const prev = records[i - 1];
      const curr = records[i];

      const prevSec = prev.elapsed_seconds ?? prev.elapsedSeconds ?? 0;
      const currSec = curr.elapsed_seconds ?? curr.elapsedSeconds ?? 0;
      const dtSec = currSec - prevSec;
      if (!Number.isFinite(dtSec) || dtSec <= 0 || dtSec > MAX_OBSERVED_GAP_SECONDS) continue;

      const hr = curr.heart_rate ?? curr.heartRate ?? 0;
      if (!Number.isFinite(hr) || hr < restingHr || hr > maxHr) continue;

      // Heart Rate Reserve fraction
      const hrrFraction = Math.min(1.0, Math.max(0, (hr - restingHr) / hrReserve));

      // Banister's cardiac impulse accumulation
      const impulse = (dtSec / 60) * hrrFraction * genderFactor * Math.exp(expMultiplier * hrrFraction);
      accumulatedTrimp += impulse;

      // 5-zone physiological bucket accumulation
      if (hr <= boundaries.z2[1]) {
        if (hr <= boundaries.z1[1]) {
          z1Sec += dtSec;
        } else {
          z2Sec += dtSec;
        }
      } else if (hr <= boundaries.z3[1]) {
        z3Sec += dtSec;
      } else if (hr <= boundaries.z4[1]) {
        z4Sec += dtSec;
      } else {
        z5Sec += dtSec;
      }
    }
  } else if (fallbackSummary && fallbackSummary.durationSeconds && fallbackSummary.avgHeartRate) {
    const durationMin = Math.max(0, fallbackSummary.durationSeconds / 60);
    const avgHr = fallbackSummary.avgHeartRate;
    const hrrFraction = Math.min(1.0, Math.max(0, (avgHr - restingHr) / hrReserve));
    accumulatedTrimp = durationMin * hrrFraction * genderFactor * Math.exp(expMultiplier * hrrFraction);

    // Approximate zone distribution from average HR
    if (avgHr <= boundaries.z1[1]) {
      z1Sec = fallbackSummary.durationSeconds;
    } else if (avgHr <= boundaries.z2[1]) {
      z2Sec = fallbackSummary.durationSeconds;
    } else if (avgHr <= boundaries.z3[1]) {
      z3Sec = fallbackSummary.durationSeconds;
    } else if (avgHr <= boundaries.z4[1]) {
      z4Sec = fallbackSummary.durationSeconds;
    } else {
      z5Sec = fallbackSummary.durationSeconds;
    }
  }

  // Scale TRIMP into relative training-load units; this is not a calibrated EPOC model.
  const trainingLoad = Math.max(1, Math.round(accumulatedTrimp));

  return {
    trainingLoad,
    zones: {
      z1Seconds: Math.round(z1Sec),
      z2Seconds: Math.round(z2Sec),
      z3Seconds: Math.round(z3Sec),
      z4Seconds: Math.round(z4Sec),
      z5Seconds: Math.round(z5Sec)
    }
  };
}

/**
 * Calculates current 7-day Acute Load, 28-day Chronic Load, ACWR, and the Optimal Load Tunnel timeline.
 */
export function calculateTrainingStatus(
  db: Database.Database,
  daysHistory: number = 90
): TrainingStatusResult {
  const historyDays = Number.isFinite(daysHistory) ? Math.max(1, Math.trunc(daysHistory)) : 90;
  const today = new Date().toISOString().substring(0, 10);
  const todayTime = Date.parse(today);
  // Aggregate all prior training. A chart's display window must not determine
  // the starting fitness baseline, and SQLite 'now' must not use a separate clock.
  const rows = db.prepare(`
    SELECT substr(start_time, 1, 10) AS date,
      SUM(CASE WHEN training_load > 0 THEN training_load
        ELSE ROUND(MAX(0, COALESCE(duration_seconds, 0)) / 60.0 * 1.1) END) AS daily_load,
      COUNT(*) AS activity_count
    FROM activities
    WHERE julianday(start_time) < julianday(?, '+1 day')
    GROUP BY substr(start_time, 1, 10)
    ORDER BY date ASC
  `).all(today) as Array<{ date: string; daily_load: number; activity_count: number }>;

  // Aggregate daily load into a map: YYYY-MM-DD -> totalDailyLoad
  const dailyLoads = new Map<string, number>();
  let recentActivityCount = 0;
  for (const r of rows) {
    dailyLoads.set(r.date, r.daily_load);
    // Keep readiness to establish a baseline independent of chart length too.
    if (Date.parse(r.date) >= todayTime - 35 * 86400000) recentActivityCount += r.activity_count;
  }

  // Only materialize the displayed days (at least seven for last7DaysLoad).
  const totalDaysToDisplay = Math.max(7, historyDays);
  const timelineDates: string[] = [];
  for (let d = totalDaysToDisplay - 1; d >= 0; d--) {
    const date = new Date(todayTime - d * 86400000);
    timelineDates.push(date.toISOString().substring(0, 10));
  }

  // Exponential decay constants
  // Acute decay: 7-day time constant (decay factor ~ 0.8669 per day)
  const decayAcute = Math.exp(-1 / 7);
  // Chronic decay: 28 days baseline (decay factor ~ 0.9649 per day)
  const decayChronic = Math.exp(-1 / 28);

  // Normalization scaling factor so that steady training produces Acute == Chronic
  // For rolling decayed sum, steady-state multiplier is 1 / (1 - decay)
  // For 7-day equivalent sum, we normalize chronic so both have equal scale
  const acuteSteadyState = 1 / (1 - decayAcute);
  const chronicSteadyState = 1 / (1 - decayChronic);
  const chronicScale = acuteSteadyState / chronicSteadyState;

  let runningAcute = 0;
  let runningChronic = 0;

  // Seed the day before the chart using exact decayed contributions from older
  // training, without iterating over years of rest days or truncating the tail.
  const seedTime = Date.parse(timelineDates[0]) - 86400000;
  for (const [date, load] of dailyLoads) {
    const time = Date.parse(date);
    if (time > seedTime) continue;
    const daysAgo = (seedTime - time) / 86400000;
    runningAcute += load * Math.exp(-daysAgo / 7);
    runningChronic += load * Math.exp(-daysAgo / 28);
  }

  const fullPoints: DayLoadPoint[] = [];

  for (const dateStr of timelineDates) {
    const dayLoad = dailyLoads.get(dateStr) || 0;

    runningAcute = runningAcute * decayAcute + dayLoad;
    runningChronic = runningChronic * decayChronic + dayLoad;

    const normalizedChronic = runningChronic * chronicScale;

    // ACWR (Acute to Chronic Workload Ratio)
    const acwr = normalizedChronic > 5 ? Number((runningAcute / normalizedChronic).toFixed(2)) : 1.0;
    const optimalMin = Math.round(normalizedChronic * 0.8);
    const optimalMax = Math.round(normalizedChronic * 1.3);

    fullPoints.push({
      date: dateStr,
      dailyLoad: dayLoad,
      acuteLoad: Math.round(runningAcute),
      chronicLoad: Math.round(normalizedChronic),
      optimalMin,
      optimalMax,
      acwr
    });
  }

  // Take only the requested history window for the client timeline
  const resultTimeline = fullPoints.slice(-historyDays);
  const latestPoint = fullPoints[fullPoints.length - 1] || {
    acuteLoad: 0,
    chronicLoad: 0,
    optimalMin: 0,
    optimalMax: 0,
    acwr: 1.0
  };

  const currentAcute = latestPoint.acuteLoad;
  const currentChronic = latestPoint.chronicLoad;
  const currentAcwr = latestPoint.acwr;

  // Compute unweighted sum over past 7 calendar days
  let last7DaysLoad = 0;
  for (let i = 0; i < 7; i++) {
    const pt = fullPoints[fullPoints.length - 1 - i];
    if (pt) last7DaysLoad += pt.dailyLoad;
  }

  // Determine training status classification
  let status: TrainingStatusType = 'optimal';
  let statusLabel = 'Optimal';
  let statusDescription = 'Your training load is productive and well-matched to your fitness baseline.';

  if (currentChronic < 40 && recentActivityCount < 5) {
    status = 'establishing';
    statusLabel = 'Establishing';
    statusDescription = 'Logging more runs will establish your long-term fitness baseline and optimal load tunnel.';
  } else if (currentAcwr < 0.8) {
    status = 'recovery';
    statusLabel = 'Recovery';
    statusDescription = 'Your training load has decreased below your baseline. Ideal for deloading or race taper.';
  } else if (currentAcwr > 1.5) {
    status = 'very_high';
    statusLabel = 'Very High';
    statusDescription = 'Acute fatigue is significantly elevated relative to fitness. High risk of overtraining.';
  } else if (currentAcwr > 1.3) {
    status = 'overreaching';
    statusLabel = 'Overreaching';
    statusDescription = 'Training load is ramping up quickly. Maintain adequate recovery to absorb adaptations.';
  } else if (currentAcwr >= 0.8 && currentAcwr <= 1.05 && currentAcute < currentChronic) {
    status = 'maintaining';
    statusLabel = 'Maintaining';
    statusDescription = 'Training load is steady and sufficient to maintain your current aerobic fitness level.';
  }

  return {
    currentAcuteLoad: currentAcute,
    currentChronicLoad: currentChronic,
    acwr: currentAcwr,
    status,
    statusLabel,
    statusDescription,
    optimalRange: {
      min: latestPoint.optimalMin,
      max: latestPoint.optimalMax
    },
    last7DaysLoad,
    timeline: resultTimeline
  };
}
