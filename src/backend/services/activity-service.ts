import { parseCoachMessages } from '../../shared/coaching.js';
import { rebuildAffectedHistory } from '../application/analysis/rebuild-history.js';
import { thresholdTime } from '../../shared/threshold-trend.js';
import Database from 'better-sqlite3';
import { activityFromRow, activityIntervalFromRow, activityRecordFromRow, activitySplitFromRow, coachSummaryFromRow, heartRateRecordFromRow, objectRow, progressActivityFromRow, volumeActivityFromRow } from '../db/rows.js';
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
import { generateCoachSummary, syncActivityCoachSummary } from '../physiology/coach-summary.js';
import { extractSteadyStateMetrics } from '../physiology/economy.js';
import { syncActivityWeather } from '../physiology/weather.js';
import { getHeartRateProfileAtDate } from '../physiology/threshold-tracker.js';
import { calculateActivityTrainingLoad, calculateTrainingStatus } from '../physiology/training-load.js';
import { getAthleteBestEfforts } from '../physiology/best-efforts.js';

/** Tags the client is allowed to apply to an activity. */
export const ALLOWED_TAGS = [
  'Easy Base',
  'Long Run',
  'Recovery',
  'Threshold',
  'VO2 Max',
  'Tempo',
  'Marathon Pace',
  'Strides',
  'Race'
];

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

  const recStmt = db.prepare('SELECT elapsed_seconds, heart_rate FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC');

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
      const recs = recStmt.all(a.id).map(heartRateRecordFromRow);
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
    const recs = db.prepare('SELECT elapsed_seconds, heart_rate FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(a.id).map(heartRateRecordFromRow);
    for (let i = 1; i < recs.length; i++) {
      const dt = Math.max(0, Math.min(10, recs[i].elapsed_seconds - recs[i - 1].elapsed_seconds));
      const hr = recs[i].heart_rate;
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


/** GET /api/activities - list all runs */
export function listActivitiesService(db: Database.Database, typeFilter?: string): ActivityListResponse {
  const activityColumns = new Set((db.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(column => column.name));
  const pm25ValueColumn = activityColumns.has('weather_pm25_ug_m3') ? 'a.weather_pm25_ug_m3' : 'NULL AS weather_pm25_ug_m3';
  const pm25SourceColumn = activityColumns.has('weather_pm25_source') ? 'a.weather_pm25_source' : 'NULL AS weather_pm25_source';
  let query = `
    SELECT
      a.id, a.start_time, a.name, a.run_type, a.auto_run_type,
      a.distance_meters, a.duration_seconds, a.avg_pace_sec_km,
      a.avg_heart_rate, a.max_heart_rate, a.avg_cadence, a.calories,
      a.elevation_gain_m, a.avg_temperature, a.avg_vertical_oscillation,
      a.avg_stance_time, a.efficiency_factor, a.aerobic_decoupling_pct,
      a.meters_per_beat, a.tags,
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
      const { analysis_json, ...activity } = row;
      let analysis: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(typeof analysis_json === 'string' ? analysis_json : 'null');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) analysis = parsed as Record<string, unknown>;
      } catch { /* Legacy analysis may be absent. */ }
      return { ...activityFromRow(activity), verdict: parseSessionVerdict(analysis?.verdict) };
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
  const rawRecords = db.prepare('SELECT * FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(id).map(activityRecordFromRow);

  // Auto-repair flat or corrupted speed telemetry (e.g. FIT records where speed was saved as static cumulative average)
  const records = [...rawRecords];
  if (records.length >= 20) {
    const validSpeeds = records.map(r => r.speed_mps).filter((s): s is number => s !== null && s > 0);
    const hasDistances = records.filter(r => r.distance_m !== null && r.distance_m > 0).length >= 20;
    let isBrokenSpeed = false;
    if (validSpeeds.length >= 20) {
      const minS = Math.min(...validSpeeds);
      const maxS = Math.max(...validSpeeds);
      if (maxS - minS < 0.15 && minS > 1.0) {
        isBrokenSpeed = true;
      }
    } else if (validSpeeds.length === 0 && hasDistances) {
      isBrokenSpeed = true;
    }

    if (isBrokenSpeed && hasDistances) {
      const windowSec = 5;
      for (let i = 0; i < records.length; i++) {
        const cur = records[i];
        if (cur.distance_m === null) continue;
        let prevIdx = i;
        while (prevIdx > 0 && cur.elapsed_seconds - records[prevIdx].elapsed_seconds < windowSec) {
          prevIdx--;
        }
        let nextIdx = i;
        while (nextIdx < records.length - 1 && records[nextIdx].elapsed_seconds - cur.elapsed_seconds < windowSec) {
          nextIdx++;
        }
        const prev = records[prevIdx];
        const next = records[nextIdx];
        if (prev.distance_m !== null && next.distance_m !== null) {
          const dt = next.elapsed_seconds - prev.elapsed_seconds;
          const dd = next.distance_m - prev.distance_m;
          if (dt >= 2 && dd >= 0) {
            const derived = dd / dt;
            cur.speed_mps = Number(Math.max(0, Math.min(9.0, derived)).toFixed(3));
          }
        }
      }
    }
  }

  // Isolate walk breaks and traffic pauses to obtain pure steady-state running metrics
  const pauseBreakdown = extractSteadyStateMetrics(records);

  // Retrieve athlete profile for calibrated thresholds (defaulting to runner profile)
  const { maxHr: maxHeartRate, restingHr, lt1Hr, lt2Hr } = getAthleteHeartRateProfile(db);

  // Generate, persist, and retrieve from activity_coach_summaries table
  const coachSummary = syncActivityCoachSummary(db, id, undefined, { persist: options.persistCoachSummary !== false }) || generateCoachSummary({
    runType: activity.run_type || 'easy_base',
    distanceKm: activity.distance_meters / 1000,
    durationMin: activity.duration_seconds / 60,
    avgPaceSecKm: activity.avg_pace_sec_km || 0,
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
    records
  });

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
    coachSummary: (coachSummary as ActivityCoachSummary) || null,
    heartRateThresholds: { lt1Hr, lt2Hr },
    pauseBreakdown,
    fitMetadata: (() => {
      const row = db.prepare('SELECT metadata_json FROM activity_fit_details WHERE activity_id = ?').get(id) as { metadata_json: string } | undefined;
      return row ? JSON.parse(row.metadata_json) as Record<string, unknown> : null;
    })()
  };
}


/** GET /api/activities/:id/coach-summary - retrieve persistent coach summary from table */
export function getActivityCoachSummaryService(db: Database.Database, id: string): CoachSummaryResponse | null {
  let coachRowValue: unknown = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get(id);
  if (!coachRowValue) {
    syncActivityCoachSummary(db, id);
    coachRowValue = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get(id);
  }
  if (!coachRowValue) return null;
  const coachRow = coachSummaryFromRow(coachRowValue);

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
      messages: parseCoachMessages(analysis?.messages),
      headline: coachRow.headline,
      verdict: parseSessionVerdict(analysis?.verdict),
      effectivenessScore: coachRow.effectiveness_score,
      rating5: Number((coachRow.effectiveness_score / 20).toFixed(1)),
      stars: coachRow.effectiveness_score >= 85 ? 3 : coachRow.effectiveness_score >= 70 ? 2 : 1,
      scoreBreakdown: parseArray(coachRow.score_breakdown_json),
      keyInsights: parseStringArray(coachRow.key_insights_json),
      insightTones: parseArray(coachRow.insight_tones_json),
      recommendation: coachRow.recommendation,
      focusAdvice: analysis?.focusAdvice ?? null,
      rubricCoveragePct: analysis?.rubricCoveragePct ?? null,
      rubricFamily: analysis?.rubricFamily ?? null,
      walkAudit: analysis?.walkAudit ?? null,
      context: analysis?.context ?? null,
      updatedAt: coachRow.updated_at,
      steadyPaceSecKm: coachRow.steady_pace_sec_km,
      steadyHeartRate: coachRow.steady_heart_rate,
      steadyCadence: coachRow.steady_cadence,
      steadyStanceTime: coachRow.steady_stance_time,
      pauseBreakdown: coachRow.pause_breakdown_json ? (() => { try { return JSON.parse(coachRow.pause_breakdown_json); } catch { return null; } })() : null
    }
  };
}

/** POST /api/activities/:id/weather/refresh - manually trigger or refresh historical weather */
export async function refreshActivityWeatherService(db: Database.Database, id: string): Promise<WeatherRefreshResponse | null> {
  const weather = await syncActivityWeather(db, id);
  if (!weather) return null;
  const updated = db.prepare('SELECT * FROM activities WHERE id = ?').get(id);
  if (!updated) return null;
  const coachSummary = syncActivityCoachSummary(db, id);
  return { activity: activityFromRow(updated), weather, coachSummary };
}

export interface UpdateActivityInput {
  run_type?: string;
  is_failed_workout?: boolean;
  name?: string;
  tags?: unknown;
}

export type UpdateActivityResult =
  | { ok: true; response: ActivityPatchResponse }
  | { ok: false; status: 400 | 404; code: 'ERR_INVALID_TAGS' | 'ERR_NO_FIELDS_TO_UPDATE' | 'ERR_ACTIVITY_NOT_FOUND'; error: string };

/** PATCH /api/activities/:id - manual override for run_type or notes */
export function updateActivityService(db: Database.Database, id: string, input: UpdateActivityInput): UpdateActivityResult {
  const { run_type, is_failed_workout, name, tags } = input;

  const updates: string[] = [];
  const params: string[] = [];

  if (run_type) {
    updates.push('run_type = ?', 'manual_run_type = ?');
    params.push(run_type, run_type);
  }
  if (is_failed_workout !== undefined) {
    updates.push('manual_failed_workout = ?');
    params.push(is_failed_workout ? '1' : '0');
  }
  if (name) {
    updates.push('name = ?');
    params.push(name);
  }
  if (tags !== undefined) {
    let tagList: string[] = [];
    if (Array.isArray(tags)) {
      tagList = tags;
    } else if (typeof tags === 'string') {
      try {
        const parsed = JSON.parse(tags);
        tagList = Array.isArray(parsed) ? parsed : [tags];
      } catch {
        tagList = [tags];
      }
    }

    const invalidTags = tagList.filter(t => typeof t !== 'string' || !ALLOWED_TAGS.includes(t));
    if (invalidTags.length > 0) {
      return {
        ok: false,
        status: 400,
        code: 'ERR_INVALID_TAGS',
        error: `Invalid tags: ${invalidTags.join(', ')}. Only existing tags are allowed (${ALLOWED_TAGS.join(', ')}).`
      };
    }

    updates.push('tags = ?');
    params.push(JSON.stringify(tagList));
  }

  if (updates.length === 0) {
    return { ok: false, status: 400, code: 'ERR_NO_FIELDS_TO_UPDATE', error: 'No fields to update' };
  }

  const previous = db.prepare('SELECT start_time FROM activities WHERE id = ?').get(id) as { start_time: string } | undefined;
  if (!previous) {
    return { ok: false, status: 404, code: 'ERR_ACTIVITY_NOT_FOUND', error: 'Activity not found' };
  }

  return db.transaction(() => {
    params.push(id);
    db.prepare(`UPDATE activities SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (run_type || is_failed_workout !== undefined) {
      rebuildAffectedHistory(db, { fromTime: thresholdTime(previous.start_time) });
      // An explicitly supplied tag edit remains authoritative for this request.
      const tagIndex = updates.indexOf('tags = ?');
      if (tagIndex >= 0) db.prepare('UPDATE activities SET tags = ? WHERE id = ?').run(params[tagIndex], id);
    }
    const coachSummary = syncActivityCoachSummary(db, id);
    const updated = db.prepare('SELECT * FROM activities WHERE id = ?').get(id);
    return { ok: true as const, response: { activity: activityFromRow(updated), coachSummary } };
  })();
}

export function parseActivityUpdate(value: unknown): UpdateActivityInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['run_type', 'is_failed_workout', 'name', 'tags'].includes(key))) return null;
  if (row.is_failed_workout !== undefined && typeof row.is_failed_workout !== 'boolean') return null;
  if (row.run_type !== undefined && typeof row.run_type !== 'string') return null;
  if (row.name !== undefined && typeof row.name !== 'string') return null;
  if (row.tags !== undefined && typeof row.tags !== 'string' &&
      (!Array.isArray(row.tags) || !row.tags.every(tag => typeof tag === 'string'))) return null;
  return row as UpdateActivityInput;
}
