import Database from 'better-sqlite3';
import type {
  CalibrationHistoryItem, ThresholdsResponse,
} from '../../shared/thresholds.js';
import { getAthleteHeartRateProfile } from '../physiology/athlete-profile.js';
import { BENCHMARK_FRESHNESS_DAYS, calculateRacePredictions, isFreshPredictionEvidence, type RaceBenchmark } from '../physiology/predictions.js';
import { getCurrentThresholds } from '../physiology/threshold-tracker.js';
import { getDefaultZones } from '../physiology/zones.js';
import { objectRow } from '../db/rows.js';

function thresholdNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid physiological_thresholds.${key}`);
  return value;
}
function thresholdText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`Invalid physiological_thresholds.${key}`);
  return value;
}
function historyRow(value: unknown): CalibrationHistoryItem {
  const row = objectRow(value, 'physiological_thresholds');
  const effectiveDate = thresholdText(row, 'effective_date');
  if (!effectiveDate) throw new Error('Invalid physiological_thresholds.effective_date');
  const id = thresholdNumber(row, 'id');
  const estimated = row.is_estimated;
  if (estimated != null && typeof estimated !== 'boolean' && estimated !== 0 && estimated !== 1) throw new Error('Invalid physiological_thresholds.is_estimated');
  const activityName = row.activity_name;
  if (activityName != null && typeof activityName !== 'string') throw new Error('Invalid activities.name');
  const activityRunType = activityText(row.activity_run_type, 'run_type');
  const distance = row.distance_meters;
  const duration = row.duration_seconds;
  for (const [key, metric] of [['distance_meters', distance], ['duration_seconds', duration]] as const) {
    if (metric != null && (typeof metric !== 'number' || !Number.isFinite(metric))) throw new Error(`Invalid activities.${key}`);
  }
  return {
    ...(id == null ? {} : { id }), effective_date: effectiveDate,
    source_activity_id: thresholdText(row, 'source_activity_id'), activity_name: activityName as string | null,
    activity_run_type: activityRunType,
    lt1_hr: thresholdNumber(row, 'lt1_hr'), lt1_pace_sec_km: thresholdNumber(row, 'lt1_pace_sec_km'),
    lt2_hr: thresholdNumber(row, 'lt2_hr'), lt2_pace_sec_km: thresholdNumber(row, 'lt2_pace_sec_km'),
    baseline_economy_ef: thresholdNumber(row, 'baseline_economy_ef'), confidence: thresholdNumber(row, 'confidence'),
    is_estimated: estimated == null ? estimated : Boolean(estimated), notes: thresholdText(row, 'notes'),
    distance_meters: distance as number | null, duration_seconds: duration as number | null
  };
}
function activityNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid activities.${field}`);
  return value;
}
function activityText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`Invalid activities.${field}`);
  return value;
}

/** GET /api/thresholds - LT1/LT2 timeline, pace-dependent economy curves, and race predictions */
export function getThresholdsService(db: Database.Database, runTypeFilter?: string): ThresholdsResponse {
  const history = db.prepare(`
    SELECT
      p.*,
      a.name as activity_name,
      a.run_type as activity_run_type,
      a.distance_meters,
      a.duration_seconds
    FROM physiological_thresholds p
    LEFT JOIN activities a ON p.source_activity_id = a.id
    ORDER BY p.effective_date DESC
  `).all().map(historyRow);

  const currentThresholds = getCurrentThresholds(db);
  const hrProfile = getAthleteHeartRateProfile(db);
  const zones = getDefaultZones(hrProfile.maxHr, currentThresholds.lt1Hr, currentThresholds.lt2Hr, hrProfile.restingHr);

  // Latest LT1 & LT2
  const latestLt1Value: unknown = db.prepare(`
    SELECT lt1_hr, lt1_pace_sec_km, effective_date, baseline_economy_ef
    FROM physiological_thresholds
    WHERE lt1_hr IS NOT NULL
    ORDER BY effective_date DESC, id DESC
    LIMIT 1
  `).get() as unknown;

  const latestLt2Value: unknown = db.prepare(`
    SELECT lt2_hr, lt2_pace_sec_km, effective_date
    FROM physiological_thresholds
    WHERE lt2_hr IS NOT NULL
    ORDER BY effective_date DESC, id DESC
    LIMIT 1
  `).get() as unknown;

  const latestLt1Row = latestLt1Value == null ? undefined : historyRow(latestLt1Value);
  const latestLt2Row = latestLt2Value == null ? undefined : historyRow(latestLt2Value);

  const latestLt1Pace = latestLt1Row?.lt1_pace_sec_km ?? currentThresholds.lt1PaceSecKm;
  const latestLt2Pace = latestLt2Row?.lt2_pace_sec_km ?? currentThresholds.lt2PaceSecKm;

  const latestLt1: CalibrationHistoryItem = latestLt1Row ? {
    ...latestLt1Row,
    lt1_hr: currentThresholds.lt1Hr,
    lt1_pace_sec_km: currentThresholds.lt1PaceSecKm || latestLt1Row.lt1_pace_sec_km,
    is_estimated: false
  } : {
    lt1_hr: currentThresholds.lt1Hr,
    lt1_pace_sec_km: currentThresholds.lt1PaceSecKm,
    effective_date: currentThresholds.lastCalibratedDate || 'Baseline',
    baseline_economy_ef: null,
    is_estimated: !currentThresholds.lt1PaceSecKm
  };

  // Average overall pace from recent runs for prediction baseline
  const predictionNow = new Date();
  const predictionCutoff = new Date(predictionNow.getTime() - BENCHMARK_FRESHNESS_DAYS * 86400000);
  // The coarse SQL bounds allow both local timestamps and offset-bearing ISO
  // timestamps. Apply exact freshness in JS, where both formats parse correctly.
  const coarseFrom = new Date(predictionCutoff.getTime() - 86400000).toISOString();
  const coarseTo = new Date(predictionNow.getTime() + 86400000).toISOString();
  const recentPaces = db.prepare(`
    SELECT start_time, avg_pace_sec_km
    FROM activities
    WHERE avg_pace_sec_km > 0 AND datetime(start_time) BETWEEN datetime(?) AND datetime(?)
  `).all(coarseFrom, coarseTo).flatMap(value => {
    const row = objectRow(value, 'activities');
    const date = activityText(row.start_time, 'start_time');
    const pace = activityNumber(row.avg_pace_sec_km, 'avg_pace_sec_km');
    return pace != null && pace > 0 && isFreshPredictionEvidence(date, predictionNow) ? [pace] : [];
  });
  const avgRecent = recentPaces.length ? recentPaces.reduce((sum, pace) => sum + pace, 0) / recentPaces.length : null;

  // If LT2 has not been calibrated through a threshold workout or race:
  // Estimate LT2 pace based on aerobic turnpoint mechanics (~86% of LT1 pace),
  // or from recent overall running pace.
  let effectiveLt2Pace: number | null = currentThresholds.lt2PaceSecKm || latestLt2Pace;
  let isLt2Estimated = false;

  if (!effectiveLt2Pace) {
    if (latestLt1Pace) {
      effectiveLt2Pace = Math.round(latestLt1Pace * 0.86);
      isLt2Estimated = true;
    } else if (avgRecent) {
      effectiveLt2Pace = Math.round(avgRecent * 0.88);
      isLt2Estimated = true;
    }
  }

  const latestLt2: CalibrationHistoryItem = latestLt2Row ? {
    ...latestLt2Row,
    lt2_hr: currentThresholds.lt2Hr,
    lt2_pace_sec_km: currentThresholds.lt2PaceSecKm || effectiveLt2Pace,
    is_estimated: false
  } : {
    lt2_hr: currentThresholds.lt2Hr,
    lt2_pace_sec_km: effectiveLt2Pace,
    effective_date: isLt2Estimated ? (latestLt1Pace ? 'Estimated from LT1' : 'Estimated from Recent Runs') : (currentThresholds.lastCalibratedDate || 'Baseline'),
    is_estimated: isLt2Estimated
  };

  // Check for proven 5K benchmark (from actual 5k time trial / race or profile PB)
  let benchmark5k: RaceBenchmark | null = null;
  const race5kCandidates = db.prepare(`
    SELECT a.id, a.start_time, a.avg_pace_sec_km, i.avg_pace_sec_km AS benchmark_pace_sec_km
    FROM activities a
    LEFT JOIN activity_intervals i ON i.activity_id = a.id AND i.type = 'work'
      AND i.distance_meters BETWEEN 4500 AND 5500 AND i.duration_seconds >= 600
      AND i.avg_pace_sec_km > 0
    WHERE a.run_type = 'race' AND datetime(a.start_time) BETWEEN datetime(?) AND datetime(?)
      AND ((a.distance_meters BETWEEN 4500 AND 5500 AND a.avg_pace_sec_km > 0) OR i.activity_id IS NOT NULL)
    ORDER BY i.avg_pace_sec_km ASC
  `).all(coarseFrom, coarseTo).map(value => {
    const row = objectRow(value, 'activities');
    const id = activityText(row.id, 'id');
    if (!id) throw new Error('Invalid activities.id');
    return { id, start_time: activityText(row.start_time, 'start_time'), avg_pace_sec_km: activityNumber(row.avg_pace_sec_km, 'avg_pace_sec_km'),
      benchmark_pace_sec_km: activityNumber(row.benchmark_pace_sec_km, 'benchmark_pace_sec_km') };
  }).filter(activity => isFreshPredictionEvidence(activity.start_time, predictionNow))
    .sort((a, b) => new Date(b.start_time!.replace(' ', 'T')).getTime() - new Date(a.start_time!.replace(' ', 'T')).getTime());
  const race5kAct = race5kCandidates[0];

  if (race5kAct) {
    const workInvPace = race5kAct.benchmark_pace_sec_km;
    if (workInvPace) {
      benchmark5k = { paceSecKm: workInvPace, date: race5kAct.start_time, source: 'race_segment', activityId: race5kAct.id };
    } else if (race5kAct.avg_pace_sec_km) {
      benchmark5k = { paceSecKm: race5kAct.avg_pace_sec_km, date: race5kAct.start_time, source: 'race_activity', activityId: race5kAct.id };
    }
  }

  if (!benchmark5k) {
    const profileValue: unknown = db.prepare("SELECT pb_5k FROM athlete_profile WHERE id = 'primary'").get();
    const pb5k = profileValue == null ? null : activityText(objectRow(profileValue, 'athlete_profile').pb_5k, 'pb_5k');
    if (pb5k) {
      const match = pb5k.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        const totalSec = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
        benchmark5k = { paceSecKm: Math.round(totalSec / 5), date: null, source: 'profile_pb' };
      } else {
        const minMatch = pb5k.match(/(\d{1,2})\s*(?:min|m)?/i);
        if (minMatch && parseInt(minMatch[1], 10) >= 12 && parseInt(minMatch[1], 10) <= 60) {
          benchmark5k = { paceSecKm: Math.round((parseInt(minMatch[1], 10) * 60) / 5), date: null, source: 'profile_pb' };
        }
      }
    }
  }

  // Race predictions
  const predictionsResult = calculateRacePredictions(
    latestLt2?.lt2_pace_sec_km ?? null,
    latestLt1?.lt1_pace_sec_km ?? null,
    avgRecent,
    benchmark5k,
    { asOf: predictionNow, lt2EffectiveDate: latestLt2Row?.effective_date, lt2IsEstimated: isLt2Estimated,
      lt2EstimateSource: latestLt1Pace ? 'lt1' : 'recent_runs' }
  );

  // Pace-dependent economy curves:
  // 1. Filtered timeline
  let query = `
    SELECT
      id, start_time, name, run_type, efficiency_factor,
      meters_per_beat, aerobic_decoupling_pct, avg_pace_sec_km, avg_heart_rate
    FROM activities
    WHERE efficiency_factor IS NOT NULL
  `;
  const params: string[] = [];

  if (runTypeFilter && runTypeFilter !== 'all') {
    if (runTypeFilter === 'easy') {
      query += ` AND (run_type = 'easy_base' OR run_type = 'long_run')`;
    } else if (runTypeFilter === 'threshold') {
      query += ` AND (run_type = 'threshold_lt2' OR run_type = 'intervals_vo2')`;
    } else {
      query += ` AND run_type = ?`;
      params.push(runTypeFilter);
    }
  }
  query += ` ORDER BY start_time ASC`;

  const economyTrend = db.prepare(query).all(...params).map(value => {
    const row = objectRow(value, 'activities');
    const id = activityText(row.id, 'id'); const startTime = activityText(row.start_time, 'start_time');
    if (!id || !startTime) throw new Error('Invalid activities economy trend identity');
    return { id, start_time: startTime, name: activityText(row.name, 'name'), run_type: activityText(row.run_type, 'run_type'),
      efficiency_factor: activityNumber(row.efficiency_factor, 'efficiency_factor'), meters_per_beat: activityNumber(row.meters_per_beat, 'meters_per_beat'),
      aerobic_decoupling_pct: activityNumber(row.aerobic_decoupling_pct, 'aerobic_decoupling_pct'),
      avg_pace_sec_km: activityNumber(row.avg_pace_sec_km, 'avg_pace_sec_km'), avg_heart_rate: activityNumber(row.avg_heart_rate, 'avg_heart_rate') };
  });

  // 2. Scatter data for Pace vs Efficiency Factor / HR curve
  const scatterData = db.prepare(`
    SELECT
      id, start_time, name, run_type,
      avg_pace_sec_km, avg_heart_rate, efficiency_factor, meters_per_beat
    FROM activities
    WHERE avg_pace_sec_km IS NOT NULL
      AND avg_heart_rate IS NOT NULL
      AND efficiency_factor IS NOT NULL
    ORDER BY avg_pace_sec_km ASC
  `).all().map(value => {
    const row = objectRow(value, 'activities');
    const id = activityText(row.id, 'id'); const startTime = activityText(row.start_time, 'start_time');
    const avgPace = activityNumber(row.avg_pace_sec_km, 'avg_pace_sec_km');
    const avgHr = activityNumber(row.avg_heart_rate, 'avg_heart_rate');
    const ef = activityNumber(row.efficiency_factor, 'efficiency_factor');
    if (!id || !startTime || avgPace === null || avgHr === null || ef === null) throw new Error('Invalid activities scatter point');
    return { id, start_time: startTime, name: activityText(row.name, 'name'), run_type: activityText(row.run_type, 'run_type'),
      avg_pace_sec_km: avgPace, avg_heart_rate: avgHr, efficiency_factor: ef, meters_per_beat: activityNumber(row.meters_per_beat, 'meters_per_beat') };
  });

  return {
    latest: {
      lt1: latestLt1 || null,
      lt2: latestLt2 || null,
      vo2Max: predictionsResult.vo2Max
    },
    currentThresholds,
    zones,
    predictions: predictionsResult.predictions,
    predictionEvidence: predictionsResult.evidence,
    history,
    economyTrend,
    scatterData
  };
}
