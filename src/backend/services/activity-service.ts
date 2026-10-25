import { sessionTags } from '../../shared/session-tags.js';
import { decodeStoredJson, loadExportFields } from '../db/compression.js';
import { parseScoreFactors, parseInsightTones, parseCoachContext, parseWalkAudit, parsePauseBreakdown } from '../../shared/contracts/coach-analysis.js';
import { assertDatabaseWritable, reserveDatabaseOperation, canWriteDatabase, withDatabaseOperation, currentDatabaseOperation } from '../application/database-operations.js';
import { ANALYSIS_REVISION, parseAnalysisProvenance, type AnalysisFreshness } from '../../shared/analysis-revision.js';
import { parseClassificationEvidence } from '../../shared/contracts/classification.js';
import { observedIntervals } from '../physiology/time-series.js';
import { affectedActivityIds } from '../application/analysis/rebuild-history.js';
import { loadAnalysisRecords, analysisRecordToRow } from '../db/analysis-records.js';
import { parseCoachMessages, parseCoachMessage, parseCoachMessageArray } from '../../shared/coaching.js';
import { rebuildAffectedHistory } from '../application/analysis/rebuild-history.js';
import { thresholdTime } from '../../shared/threshold-trend.js';
import Database from 'better-sqlite3';
import { activityFromRow, activityIntervalFromRow, activitySplitFromRow, coachSummaryFromRow, objectRow, progressActivityFromRow, volumeActivityFromRow } from '../db/rows.js';
import { parseSessionVerdict } from '../../shared/session-verdict.js';
import type { BestEffortsReport } from '../../shared/best-efforts.js';
import type { TrainingLoadResponse } from '../../shared/training-load.js';
import type {
  ProgressHistoryResponse, VolumeQuery, VolumeSummary,
} from '../../shared/volume.js';
import type {
  ActivityCoachSummary, ActivityDetailResponse, ActivityListResponse,
  ActivityPatchResponse, CoachSummaryResponse, WeatherRefreshResponse,
} from '../../shared/activity-detail.js';
import { getAthleteHeartRateProfile } from '../physiology/athlete-profile.js';
import { syncActivityCoachSummary } from '../physiology/coach-summary.js';
import { extractSteadyStateMetrics } from '../physiology/economy.js';
import { syncActivityWeather } from '../physiology/weather.js';
import { getHeartRateProfileAtDate } from '../physiology/threshold-tracker.js';
import { calculateActivityTrainingLoad, calculateTrainingStatus } from '../physiology/training-load.js';
import { getAthleteBestEfforts } from '../physiology/best-efforts.js';

/** GET /api/activities/best-efforts */
export function getBestEffortsService(db: Database.Database): BestEffortsReport {
  return getAthleteBestEfforts(db);
}

/** GET /api/activities/training-load */
export function getTrainingLoadService(db: Database.Database, daysHistory: number): TrainingLoadResponse {
  const days = Math.min(180, Math.max(7, daysHistory));
  return { trainingStatus: calculateTrainingStatus(db, days) };
}

/** GET /api/activities/volume */
export function getVolumeService(db: Database.Database, query: VolumeQuery): VolumeSummary {
  const period = query.period || 'month';
  const targetMonth = query.month;
  const targetYear = query.year;

  let sql = `SELECT id, start_time, distance_meters, duration_seconds, elevation_gain_m, efficiency_factor, run_type, training_load, z1_seconds, z2_seconds, z3_seconds, z4_seconds, z5_seconds FROM activities WHERE 1=1`;
  const params: Array<string | number> = [];

  if (targetMonth) {
    sql += ` AND start_time LIKE ?`;
    params.push(`${targetMonth}%`);
  } else if (targetYear) {
    sql += ` AND start_time LIKE ?`;
    params.push(`${targetYear}%`);
  } else if (period === 'week') {
    sql += ` AND start_time >= datetime('now', '-7 days')`;
  } else if (period === 'month') {
    sql += ` AND start_time >= datetime('now', '-30 days')`;
  } else if (period === 'year') {
    sql += ` AND start_time >= datetime('now', '-365 days')`;
  }

  sql += ` ORDER BY start_time DESC`;
  let acts = db.prepare(sql).all(...params).map(volumeActivityFromRow);

  // Fallback if period=month returned 0 activities because dataset is historical
  if (acts.length === 0 && !targetMonth && !targetYear && period === 'month') {
    const latestValue: unknown = db.prepare('SELECT start_time FROM activities ORDER BY start_time DESC LIMIT 1').get();
    if (latestValue) {
      const latestAct = latestValue as { start_time?: unknown };
      if (typeof latestAct.start_time !== 'string') throw new Error('Invalid activities.start_time');
      const fallbackMonth = latestAct.start_time.substring(0, 7);
      acts = db.prepare(`SELECT id, start_time, distance_meters, duration_seconds, elevation_gain_m, efficiency_factor, run_type, training_load, z1_seconds, z2_seconds, z3_seconds, z4_seconds, z5_seconds FROM activities WHERE start_time LIKE ? ORDER BY start_time DESC`).all(`${fallbackMonth}%`).map(volumeActivityFromRow);
    }
  }

  let totalDistM = 0;
  let totalDurSec = 0;
  let totalElevM = 0;
  let efSum = 0;
  let efCount = 0;
  let z1z2Sec = 0;
  let z3Sec = 0;
  let z4Sec = 0;
  let z5Sec = 0;


  for (const a of acts) {
    totalDistM += a.distance_meters || 0;
    totalDurSec += a.duration_seconds || 0;
    totalElevM += a.elevation_gain_m || 0;
    if (a.efficiency_factor) {
      efSum += a.efficiency_factor;
      efCount++;
    }

    // Fast path: precalculated zone durations from activities table
    const hasPrecomputedZones =
      typeof a.z2_seconds === 'number' &&
      ((a.z1_seconds ?? 0) > 0 || a.z2_seconds > 0 || (a.z3_seconds ?? 0) > 0 || (a.z4_seconds ?? 0) > 0 || (a.z5_seconds ?? 0) > 0);

    if (hasPrecomputedZones) {
      z1z2Sec += (a.z1_seconds || 0) + (a.z2_seconds || 0);
      z3Sec += (a.z3_seconds || 0);
      z4Sec += (a.z4_seconds || 0);
      z5Sec += (a.z5_seconds || 0);
    } else {
      const recs = loadAnalysisRecords(db, a.id);
      const load = calculateActivityTrainingLoad(recs, getHeartRateProfileAtDate(db, a.start_time));
      z1z2Sec += load.zones.z1Seconds + load.zones.z2Seconds;
      z3Sec += load.zones.z3Seconds;
      z4Sec += load.zones.z4Seconds;
      z5Sec += load.zones.z5Seconds;
    }
  }

  const totalHrSec = z1z2Sec + z3Sec + z4Sec + z5Sec;
  const periodLabels: Record<string, string> = {
    week: 'Past 7 Days',
    month: 'Past 30 Days',
    year: 'Past 365 Days',
    all: 'All-Time Total'
  };

  const z2HoursVal = Number((z1z2Sec / 3600).toFixed(1));
  const z2PctVal = totalHrSec > 0 ? Math.round((z1z2Sec / totalHrSec) * 100) : 0;
  const z3HoursVal = Number((z3Sec / 3600).toFixed(1));
  const z3PctVal = totalHrSec > 0 ? Math.round((z3Sec / totalHrSec) * 100) : 0;
  const z4HoursVal = Number((z4Sec / 3600).toFixed(1));
  const z4PctVal = totalHrSec > 0 ? Math.round((z4Sec / totalHrSec) * 100) : 0;
  const z5HoursVal = Number((z5Sec / 3600).toFixed(1));
  const z5PctVal = totalHrSec > 0 ? Math.round((z5Sec / totalHrSec) * 100) : 0;

  return {
    period,
    periodLabel: targetMonth ? `Month: ${targetMonth}` : (periodLabels[period] || 'Effort Aggregation'),
    count: acts.length,
    activityCount: acts.length,
    distanceKm: Number((totalDistM / 1000).toFixed(1)),
    totalDistanceKm: Number((totalDistM / 1000).toFixed(1)),
    durationHours: Number((totalDurSec / 3600).toFixed(1)),
    totalDurationHours: Number((totalDurSec / 3600).toFixed(1)),
    elevationGainM: Math.round(totalElevM),
    totalElevationGainM: Math.round(totalElevM),
    avgEf: efCount > 0 ? Number((efSum / efCount).toFixed(2)) : null,
    zones: {
      z1: { hours: 0, pct: 0 },
      z2: { hours: z2HoursVal, pct: z2PctVal },
      z3: { hours: z3HoursVal, pct: z3PctVal },
      z4: { hours: z4HoursVal, pct: z4PctVal },
      z5: { hours: z5HoursVal, pct: z5PctVal },
      z2Hours: z2HoursVal,
      z2Pct: z2PctVal,
      z3Hours: z3HoursVal,
      z3Pct: z3PctVal,
      z4Hours: z4HoursVal,
      z4Pct: z4PctVal,
      z5Hours: z5HoursVal,
      z5Pct: z5PctVal
    }
  };
}


/** GET /api/activities/progress-history */
export function getProgressHistoryService(db: Database.Database, runTypeFilter: string): ProgressHistoryResponse {
  const { lt1Hr } = getAthleteHeartRateProfile(db);

  let actQuery = `
    SELECT
      id, start_time, name, run_type, distance_meters, duration_seconds,
      avg_pace_sec_km, avg_heart_rate, efficiency_factor, elevation_gain_m,
      aerobic_decoupling_pct
    FROM activities
    WHERE 1=1
  `;
  const params: Array<string | number> = [];

  if (runTypeFilter === 'easy') {
    actQuery += ` AND (run_type = 'easy_base' OR run_type = 'long_run')`;
  } else if (runTypeFilter === 'threshold') {
    actQuery += ` AND (run_type = 'threshold_lt2' OR run_type = 'intervals_vo2' OR run_type = 'tempo' OR run_type = 'race')`;
  }

  actQuery += ` ORDER BY start_time ASC`;

  // Fetch activities in chronological order
  const acts = db.prepare(actQuery).all(...params).map(progressActivityFromRow);

  // Fetch all threshold calibrations
  const thresholds = db.prepare(`
    SELECT p.*, a.name as activity_name
    FROM physiological_thresholds p
    LEFT JOIN activities a ON p.source_activity_id = a.id
    ORDER BY p.effective_date ASC
  `).all().map(value => {
    const row = objectRow(value, 'physiological_thresholds');
    if (typeof row.effective_date !== 'string' || row.effective_date.length === 0) throw new Error('Invalid physiological_thresholds.effective_date');
    for (const key of ['id', 'lt1_hr', 'lt1_pace_sec_km', 'lt2_hr', 'lt2_pace_sec_km', 'baseline_economy_ef', 'confidence', 'distance_meters', 'duration_seconds']) {
      const field = row[key];
      if (field != null && (typeof field !== 'number' || !Number.isFinite(field))) throw new Error(`Invalid physiological_thresholds.${key}`);
    }
    for (const key of ['source_activity_id', 'activity_name', 'notes']) {
      if (row[key] != null && typeof row[key] !== 'string') throw new Error(`Invalid physiological_thresholds.${key}`);
    }
    if (row.is_estimated != null && typeof row.is_estimated !== 'boolean' && row.is_estimated !== 0 && row.is_estimated !== 1) throw new Error('Invalid physiological_thresholds.is_estimated');
    return { ...row, effective_date: row.effective_date };
  });

  // Group activities by Month (YYYY-MM) and Year (YYYY)
  const monthMap = new Map<string, {
    period: string; label: string; type: 'month'; runCount: number; totalDistanceM: number; totalDurationSec: number; totalElevationM: number;
    efSum: number; efCount: number; paceSum: number; paceCount: number; hrSum: number; hrCount: number; z2Sec: number; totalHrSec: number; runs: string[];
  }>();
  const yearMap = new Map<string, {
    period: string; label: string; type: 'year'; runCount: number; totalDistanceM: number; totalDurationSec: number; totalElevationM: number;
    efSum: number; efCount: number; paceSum: number; paceCount: number; hrSum: number; hrCount: number; activeMonthsSet: Set<string>; runs: string[];
  }>();

  for (const a of acts) {
    const dateStr = a.start_time || '';
    const ym = dateStr.substring(0, 7); // e.g. "2026-09"
    const yr = dateStr.substring(0, 4); // e.g. "2026"
    if (!ym || ym.length < 7) continue;

    // Month aggregation
    if (!monthMap.has(ym)) {
      const dObj = new Date(`${ym}-01`);
      const label = isNaN(dObj.getTime())
        ? ym
        : dObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      monthMap.set(ym, {
        period: ym,
        label,
        type: 'month',
        runCount: 0,
        totalDistanceM: 0,
        totalDurationSec: 0,
        totalElevationM: 0,
        efSum: 0,
        efCount: 0,
        paceSum: 0,
        paceCount: 0,
        hrSum: 0,
        hrCount: 0,
        z2Sec: 0,
        totalHrSec: 0,
        runs: []
      });
    }

    // Year aggregation
    if (!yearMap.has(yr)) {
      yearMap.set(yr, {
        period: yr,
        label: `${yr} Season`,
        type: 'year',
        runCount: 0,
        totalDistanceM: 0,
        totalDurationSec: 0,
        totalElevationM: 0,
        efSum: 0,
        efCount: 0,
        paceSum: 0,
        paceCount: 0,
        hrSum: 0,
        hrCount: 0,
        activeMonthsSet: new Set<string>(),
        runs: []
      });
    }

    const m = monthMap.get(ym)!;
    const y = yearMap.get(yr)!;

    m.runCount++;
    m.totalDistanceM += a.distance_meters || 0;
    m.totalDurationSec += a.duration_seconds || 0;
    m.totalElevationM += a.elevation_gain_m || 0;
    if (a.efficiency_factor) { m.efSum += a.efficiency_factor; m.efCount++; }
    if (a.avg_pace_sec_km) { m.paceSum += a.avg_pace_sec_km; m.paceCount++; }
    if (a.avg_heart_rate) { m.hrSum += a.avg_heart_rate; m.hrCount++; }
    m.runs.push(a.id);

    y.runCount++;
    y.totalDistanceM += a.distance_meters || 0;
    y.totalDurationSec += a.duration_seconds || 0;
    y.totalElevationM += a.elevation_gain_m || 0;
    if (a.efficiency_factor) { y.efSum += a.efficiency_factor; y.efCount++; }
    if (a.avg_pace_sec_km) { y.paceSum += a.avg_pace_sec_km; y.paceCount++; }
    if (a.avg_heart_rate) { y.hrSum += a.avg_heart_rate; y.hrCount++; }
    y.activeMonthsSet.add(ym);
    y.runs.push(a.id);

    // Heart rate zone 2 accumulation
    const recs = loadAnalysisRecords(db, a.id);
    for (const { b, seconds: dt } of observedIntervals(recs, r => r.elapsedSeconds)) {
      const hr = b.heartRate;
      if (!hr) continue;
      m.totalHrSec += dt;
      if (hr <= lt1Hr) {
        m.z2Sec += dt;
      }
    }
  }

  // Format months array
  const months = Array.from(monthMap.values()).map(m => {
    const avgEf = m.efCount > 0 ? Number((m.efSum / m.efCount).toFixed(2)) : null;
    const avgPace = m.paceCount > 0 ? Math.round(m.paceSum / m.paceCount) : null;
    const avgHr = m.hrCount > 0 ? Math.round(m.hrSum / m.hrCount) : null;
    const z2Hours = Number((m.z2Sec / 3600).toFixed(1));
    const z2Pct = m.totalHrSec > 0 ? Math.round((m.z2Sec / m.totalHrSec) * 100) : 0;
    const periodCalibrations = thresholds.filter(t => t.effective_date?.startsWith(m.period));

    return {
      period: m.period,
      label: m.label,
      runCount: m.runCount,
      totalDistanceKm: Number((m.totalDistanceM / 1000).toFixed(1)),
      totalDurationHours: Number((m.totalDurationSec / 3600).toFixed(1)),
      totalElevationM: Math.round(m.totalElevationM),
      avgEfficiencyFactor: avgEf,
      avgPaceSecKm: avgPace,
      avgHeartRate: avgHr,
      zone2Hours: z2Hours,
      zone2Pct: z2Pct,
      calibrations: periodCalibrations
    };
  });

  // Format years array
  const years = Array.from(yearMap.values()).map(y => {
    const avgEf = y.efCount > 0 ? Number((y.efSum / y.efCount).toFixed(2)) : null;
    const avgPace = y.paceCount > 0 ? Math.round(y.paceSum / y.paceCount) : null;
    const avgHr = y.hrCount > 0 ? Math.round(y.hrSum / y.hrCount) : null;
    const periodCalibrations = thresholds.filter(t => t.effective_date?.startsWith(y.period));

    return {
      period: y.period,
      label: y.label,
      runCount: y.runCount,
      activeMonths: y.activeMonthsSet.size,
      totalDistanceKm: Number((y.totalDistanceM / 1000).toFixed(1)),
      totalDurationHours: Number((y.totalDurationSec / 3600).toFixed(1)),
      totalElevationM: Math.round(y.totalElevationM),
      avgEfficiencyFactor: avgEf,
      avgPaceSecKm: avgPace,
      avgHeartRate: avgHr,
      calibrations: periodCalibrations
    };
  });

  return { months, years };
}


function activityWithDerivedTags(db: Database.Database, row: unknown) {
  const activity = activityFromRow(row);
  const strides = db.prepare("SELECT 1 FROM activity_intervals WHERE activity_id = ? AND type = 'stride' LIMIT 1").get(activity.id);
  return { ...activity, tags: JSON.stringify(sessionTags(activity.run_type, strides ? ['Strides'] : [], activity)) };
}

/** GET /api/activities - list all runs */
export function listActivitiesService(db: Database.Database, typeFilter?: string): ActivityListResponse {
  const activityColumns = new Set((db.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(column => column.name));
  const elevationLossColumn = activityColumns.has('elevation_loss_m') ? 'a.elevation_loss_m' : 'NULL AS elevation_loss_m';
  const pm25ValueColumn = activityColumns.has('weather_pm25_ug_m3') ? 'a.weather_pm25_ug_m3' : 'NULL AS weather_pm25_ug_m3';
  const pm25SourceColumn = activityColumns.has('weather_pm25_source') ? 'a.weather_pm25_source' : 'NULL AS weather_pm25_source';
  let query = `
    SELECT
      a.id, a.start_time, a.name, a.run_type, a.auto_run_type,
      a.distance_meters, a.duration_seconds, a.avg_pace_sec_km,
      a.avg_heart_rate, a.max_heart_rate, a.avg_cadence, a.calories,
      a.elevation_gain_m, ${elevationLossColumn}, a.avg_temperature, a.avg_vertical_oscillation,
      a.avg_stance_time, a.efficiency_factor, a.aerobic_decoupling_pct,
      a.meters_per_beat, a.tags,
      EXISTS (SELECT 1 FROM activity_intervals i WHERE i.activity_id = a.id AND i.type = 'stride') AS has_strides,
      a.steady_pace_sec_km, a.steady_heart_rate, a.steady_cadence,
      a.steady_stance_time, a.pause_duration_seconds, a.walk_duration_seconds,
      a.walk_distance_meters,
      a.weather_temperature_c, a.weather_humidity_pct, a.weather_apparent_temp_c,
      ${pm25ValueColumn},
      ${pm25SourceColumn},
      a.weather_condition, a.weather_code, a.weather_fetched_at, a.weather_source,
      a.workout_lat, a.workout_lon,
      cs.effectiveness_score, cs.analysis_json
    FROM activities a
    LEFT JOIN activity_coach_summaries cs ON a.id = cs.activity_id
  `;

  const params: Array<string | number> = [];
  if (typeFilter) {
    query += ` WHERE a.run_type = ?`;
    params.push(typeFilter);
  }
  query += ` ORDER BY a.start_time DESC`;

  const activities = db.prepare(query).all(...params);
  return {
    activities: activities.map(value => {
      const row = value as Record<string, unknown>;
      const { analysis_json, has_strides, ...activity } = row;
      let analysis: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(typeof analysis_json === 'string' ? analysis_json : 'null');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) analysis = parsed as Record<string, unknown>;
      } catch { /* Legacy analysis may be absent. */ }
      const parsedActivity = activityFromRow(activity);
      return { ...parsedActivity, tags: JSON.stringify(sessionTags(parsedActivity.run_type, has_strides ? ['Strides'] : [], parsedActivity)), verdict: parseSessionVerdict(analysis?.verdict) };
    })
  };
}


/** GET /api/activities/:id - deep dive into individual run */
export function getActivityDetailService(db: Database.Database, id: string, options: { persistCoachSummary?: boolean } = {}): ActivityDetailResponse | null {
  const activityRow = db.prepare('SELECT * FROM activities WHERE id = ?').get(id);
  if (!activityRow) return null;
  const activity = activityFromRow(activityRow);

  const splits = db.prepare('SELECT * FROM activity_splits WHERE activity_id = ? ORDER BY split_index ASC').all(id).map(activitySplitFromRow);
  const intervals = db.prepare('SELECT * FROM activity_intervals WHERE activity_id = ? ORDER BY interval_index ASC').all(id).map(activityIntervalFromRow);
  activity.tags = JSON.stringify(sessionTags(activity.run_type, intervals.some(interval => interval.type === 'stride') ? ['Strides'] : [], activity));
  const exportFields = loadExportFields(db, id);
  const records = loadAnalysisRecords(db, id).map((record, index) => ({ ...analysisRecordToRow(record), fit_fields_json: exportFields[index] }));

  // Isolate walk breaks and traffic pauses to obtain pure steady-state running metrics
  const pauseBreakdown = extractSteadyStateMetrics(records);

  // Historical chart bands and coaching use the same strictly preceding evidence.
  const { lt1Hr, lt2Hr } = getHeartRateProfileAtDate(db, activity.start_time, id);
  const stored = db.prepare('SELECT analysis_json FROM activity_coach_summaries WHERE activity_id = ?').get(id) as { analysis_json: string | null } | undefined;
  let revision: string | null = null;
  try {
    const analysis: unknown = stored?.analysis_json ? JSON.parse(stored.analysis_json) : null;
    if (analysis && typeof analysis === 'object' && 'revision' in analysis && typeof analysis.revision === 'string') revision = analysis.revision;
  } catch { /* Legacy summaries remain readable without revision metadata. */ }
  let freshness: AnalysisFreshness = { revision, status: !stored ? 'missing' : revision === ANALYSIS_REVISION ? 'fresh' : 'stale' };
  let coachSummary: ActivityCoachSummary | null;
  if (freshness.status === 'fresh' || !canWriteDatabase()) {
    coachSummary = getActivityCoachSummaryService(db, id, { persist: false })?.coachSummary ?? null;
    if (currentDatabaseOperation()) freshness = { ...freshness, status: 'updating' };
  } else {
    const persist = options.persistCoachSummary !== false;
    coachSummary = withDatabaseOperation('analysis', () => syncActivityCoachSummary(db, id, undefined, { persist }));
    if (persist && coachSummary) {
      freshness = { revision: ANALYSIS_REVISION, status: 'fresh' };
      Object.assign(activity, activityFromRow(db.prepare('SELECT * FROM activities WHERE id = ?').get(id)));
    }
  }

  return {
    activity: {
      ...activity,
      steady_pace_sec_km: pauseBreakdown.steadyPaceSecKm || activity.steady_pace_sec_km,
      steady_heart_rate: pauseBreakdown.steadyHeartRate || activity.steady_heart_rate,
      steady_cadence: pauseBreakdown.steadyCadence || activity.steady_cadence,
      steady_stance_time: pauseBreakdown.steadyStanceTimeMs || activity.steady_stance_time,
      pause_duration_seconds: pauseBreakdown.stopDurationSeconds,
      walk_duration_seconds: pauseBreakdown.walkDurationSeconds,
      walk_distance_meters: pauseBreakdown.walkDistanceMeters
    },
    splits,
    intervals,
    records,
    coachSummary,
    analysisFreshness: freshness,
    heartRateThresholds: { lt1Hr, lt2Hr },
    pauseBreakdown,
    fitMetadata: (() => {
      const row = db.prepare('SELECT metadata_json FROM activity_fit_details WHERE activity_id = ?').get(id) as { metadata_json: string | Buffer } | undefined;
      return row ? JSON.parse(decodeStoredJson(row.metadata_json)) as Record<string, unknown> : null;
    })()
  };
}


/** GET /api/activities/:id/coach-summary - retrieve persistent coach summary from table */
export function getActivityCoachSummaryService(db: Database.Database, id: string, options: { persist?: boolean } = {}): CoachSummaryResponse | null {
  let coachRowValue: unknown = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get(id);
  if (!coachRowValue) {
    if (options.persist === false || !canWriteDatabase()) return null;
    syncActivityCoachSummary(db, id);
    coachRowValue = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get(id);
  }
  if (!coachRowValue) return null;
  const coachRow = coachSummaryFromRow(coachRowValue);
  const steadyRow = db.prepare('SELECT steady_pace_sec_km, steady_heart_rate, steady_cadence, steady_stance_time FROM activities WHERE id = ?').get(id) as {
    steady_pace_sec_km: number | null; steady_heart_rate: number | null;
    steady_cadence: number | null; steady_stance_time: number | null;
  } | undefined;

  let analysis: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = coachRow.analysis_json ? JSON.parse(coachRow.analysis_json) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) analysis = parsed as Record<string, unknown>;
  } catch {
    analysis = null;
  }
  const parseArray = (json: string | null): unknown[] => {
    if (!json) return [];
    try { const parsed: unknown = JSON.parse(json); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  };
  const parseStringArray = (json: string): string[] => {
    const parsed = parseArray(json);
    return parsed.every(value => typeof value === 'string') ? parsed : [];
  };

  return {
    coachSummary: {
      classificationEvidence: parseClassificationEvidence(analysis?.classificationEvidence),
      analysisProvenance: parseAnalysisProvenance(analysis?.provenance),
      messages: parseCoachMessages(analysis?.messages),
      insightMessages: parseCoachMessageArray(analysis?.insightMessages),
      focusAdviceMessage: parseCoachMessage(analysis?.focusAdviceMessage) ?? null,
      headline: coachRow.headline,
      verdict: parseSessionVerdict(analysis?.verdict),
      effectivenessScore: coachRow.effectiveness_score,
      rating5: Number((coachRow.effectiveness_score / 20).toFixed(1)),
      stars: coachRow.effectiveness_score >= 85 ? 3 : coachRow.effectiveness_score >= 70 ? 2 : 1,
      scoreBreakdown: parseScoreFactors(parseArray(coachRow.score_breakdown_json)),
      keyInsights: parseStringArray(coachRow.key_insights_json),
      insightTones: parseInsightTones(parseArray(coachRow.insight_tones_json)),
      recommendation: coachRow.recommendation,
      focusAdvice: typeof analysis?.focusAdvice === 'string' ? analysis.focusAdvice : null,
      rubricCoveragePct: typeof analysis?.rubricCoveragePct === 'number' && Number.isFinite(analysis.rubricCoveragePct) ? analysis.rubricCoveragePct : null,
      rubricFamily: typeof analysis?.rubricFamily === 'string' ? analysis.rubricFamily : null,
      walkAudit: parseWalkAudit(analysis?.walkAudit),
      context: parseCoachContext(analysis?.context),
      ...(coachRow.updated_at ? { updatedAt: coachRow.updated_at } : {}),
      steadyPaceSecKm: steadyRow?.steady_pace_sec_km ?? null,
      steadyHeartRate: steadyRow?.steady_heart_rate ?? null,
      steadyCadence: steadyRow?.steady_cadence ?? null,
      steadyStanceTime: steadyRow?.steady_stance_time ?? null,
      pauseBreakdown: coachRow.pause_breakdown_json ? (() => { try { return parsePauseBreakdown(JSON.parse(coachRow.pause_breakdown_json)); } catch { return null; } })() : null
    }
  };
}

/** POST /api/activities/:id/weather/refresh - manually trigger or refresh historical weather */
export async function refreshActivityWeatherService(db: Database.Database, id: string): Promise<WeatherRefreshResponse | null> {
  const lease = reserveDatabaseOperation('weather');
  try {
    return await lease.run(async () => {
      const activity = db.prepare('SELECT start_time FROM activities WHERE id = ?').get(id) as { start_time: string } | undefined;
      if (!activity) return null;
      // Ambient baseline changes affect later coaching, without replaying physiology.
      const weather = await syncActivityWeather(db, id, () => {
        for (const affectedId of affectedActivityIds(db, thresholdTime(activity.start_time))) syncActivityCoachSummary(db, affectedId);
      });
      if (!weather) return null;
      const updated = db.prepare('SELECT * FROM activities WHERE id = ?').get(id);
      if (!updated) return null;
      const coachSummary = syncActivityCoachSummary(db, id, undefined, { persist: false });
      return { activity: activityWithDerivedTags(db, updated), weather, coachSummary };
    });
  } finally { lease.release(); }
}

export interface UpdateActivityInput {
  run_type?: string;
  name?: string;
  tags?: unknown;
  official_time_seconds?: number | null;
  official_distance_meters?: number | null;
  official_source?: 'chip' | 'gun' | null;
}

export type UpdateActivityResult =
  | { ok: true; response: ActivityPatchResponse }
  | { ok: false; status: 400 | 404; code: 'ERR_INVALID_TAGS' | 'ERR_NO_FIELDS_TO_UPDATE' | 'ERR_INVALID_OFFICIAL_RESULT' | 'ERR_ACTIVITY_NOT_FOUND'; error: string };

/** PATCH /api/activities/:id - manual override for run_type or notes */
export function updateActivityService(db: Database.Database, id: string, input: UpdateActivityInput): UpdateActivityResult {
  assertDatabaseWritable();
  const { run_type, name, tags } = input;
  const { official_time_seconds, official_distance_meters, official_source } = input;

  const updates: string[] = [];
  const params: Array<string | number | null> = [];

  if (run_type) {
    updates.push('run_type = ?', 'manual_run_type = ?');
    params.push(run_type, run_type);
  }
  if (name) {
    updates.push('name = ?');
    params.push(name);
  }
  if (tags !== undefined) {
    return { ok: false, status: 400, code: 'ERR_INVALID_TAGS', error: 'Tags are derived from the recorded run and cannot be edited.' };
  }
  if (official_time_seconds !== undefined) {
    updates.push('official_time_seconds = ?');
    params.push(official_time_seconds);
  }
  if (official_distance_meters !== undefined) {
    updates.push('official_distance_meters = ?');
    params.push(official_distance_meters);
  }
  if (official_source !== undefined) {
    updates.push('official_source = ?');
    params.push(official_source);
  }

  if (updates.length === 0) {
    return { ok: false, status: 400, code: 'ERR_NO_FIELDS_TO_UPDATE', error: 'No fields to update' };
  }

  const previous = db.prepare(
    'SELECT start_time, official_time_seconds, official_distance_meters FROM activities WHERE id = ?'
  ).get(id) as { start_time: string; official_time_seconds: number | null; official_distance_meters: number | null } | undefined;
  if (!previous) {
    return { ok: false, status: 404, code: 'ERR_ACTIVITY_NOT_FOUND', error: 'Activity not found' };
  }

  // A chip time without a certified distance cannot produce a pace, and a
  // distance without a time cannot produce a PB. Treat them as one fact.
  const nextOfficialTime = official_time_seconds !== undefined ? official_time_seconds : previous.official_time_seconds;
  const nextOfficialDistance = official_distance_meters !== undefined ? official_distance_meters : previous.official_distance_meters;
  if (nextOfficialTime != null || nextOfficialDistance != null) {
    const valid = nextOfficialTime != null && nextOfficialDistance != null &&
      Number.isFinite(nextOfficialTime) && nextOfficialTime > 0 &&
      Number.isFinite(nextOfficialDistance) && nextOfficialDistance > 0;
    if (!valid) {
      return {
        ok: false,
        status: 400,
        code: 'ERR_INVALID_OFFICIAL_RESULT',
        error: 'An official result needs a positive chip time and a positive certified distance'
      };
    }
  }

  return db.transaction(() => {
    params.push(id);
    db.prepare(`UPDATE activities SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (run_type) {
      rebuildAffectedHistory(db, { fromTime: thresholdTime(previous.start_time) });
    }
    const coachSummary = syncActivityCoachSummary(db, id);
    const updated = db.prepare('SELECT * FROM activities WHERE id = ?').get(id);
    return { ok: true as const, response: { activity: activityWithDerivedTags(db, updated), coachSummary } };
  })();
}

export function parseActivityUpdate(value: unknown): UpdateActivityInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['run_type', 'name', 'tags',
    'official_time_seconds', 'official_distance_meters', 'official_source'].includes(key))) return null;
  if (row.run_type !== undefined && typeof row.run_type !== 'string') return null;
  if (row.name !== undefined && typeof row.name !== 'string') return null;
  if (row.tags !== undefined && typeof row.tags !== 'string' &&
      (!Array.isArray(row.tags) || !row.tags.every(tag => typeof tag === 'string'))) return null;
  const isNumberOrNull = (field: unknown): boolean =>
    field === undefined || field === null || (typeof field === 'number' && Number.isFinite(field));
  if (!isNumberOrNull(row.official_time_seconds)) return null;
  if (!isNumberOrNull(row.official_distance_meters)) return null;
  if (row.official_source !== undefined && row.official_source !== null &&
      row.official_source !== 'chip' && row.official_source !== 'gun') return null;
  return row as UpdateActivityInput;
}
