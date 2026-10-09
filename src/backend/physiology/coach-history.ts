import type Database from 'better-sqlite3';
import type { Activity } from '../../shared/activity.js';
import { activityFromRow } from '../db/rows.js';
import { coachMessage } from '../domain/coaching/messages.js';
import type { RunFamily } from './coach-rubric.js';
import { runFamilyOf, formatPaceText } from './coach-rubric.js';
import { createInsightLog, type CoachInsight } from './coach-insight.js';

/**
 * AEROLAB Personal Baseline Comparison
 *
 * Compares a session against the athlete's own recent history so the coach
 * debrief talks about *this* runner instead of quoting textbook thresholds.
 *
 * Everything here is local-first: it only reads rows that already exist in
 * `data/runs.db`, and returns null when there is not enough history to make an
 * honest comparison (never guess a baseline from one run).
 */

export interface CoachContext {
  windowDays: number;
  runFamily: RunFamily;
  /** Prior runs of the same run-type family inside the window. */
  comparableRuns: number;
  /** Most recent run of the same type and similar distance in the prior 30 days. */
  lastSimilarRun: {
    id: string;
    startTime: string;
    distanceKm: number;
    paceSecKm: number;
    heartRate: number;
    aboveCeilingPct?: number | null;
  } | null;
  currentHeartRate: number | null;
  currentAboveCeilingPct?: number | null;
  baselineEf: number | null;
  efDeltaPct: number | null;
  baselineEfSamples: number;
  baselineHrAtPace: number | null;
  hrAtPaceDeltaBpm: number | null;
  hrAtPaceSamples: number;
  /** Steady pace of the graded run, so pace-specific claims can name it. */
  currentPaceSecKm: number | null;
  decouplingRank: number | null;
  decouplingSamples: number;
  decouplingBestPct: number | null;
  longestDistanceKm: number | null;
  isLongestRun: boolean;
  acute7DayLoad: number | null;
  chronicWeeklyLoad: number | null;
  acwr: number | null;
}

export interface HistoryRow {
  is_treadmill?: boolean;
  id: string;
  start_time: string;
  run_type?: string | null;
  distance_meters?: number | null;
  efficiency_factor?: number | null;
  aerobic_decoupling_pct?: number | null;
  avg_cadence?: number | null;
  avg_heart_rate?: number | null;
  steady_heart_rate?: number | null;
  avg_pace_sec_km?: number | null;
  steady_pace_sec_km?: number | null;
  training_load?: number | null;
}

export interface CurrentRun {
  isTreadmill?: boolean;
  id: string;
  start_time: string;
  runType: string;
  distanceKm: number;
  efficiencyFactor: number | null;
  decouplingPct: number | null;
  steadyPaceSecKm: number | null;
  steadyHr: number | null;
}

export interface CoachContextOptions {
  windowDays?: number;
  efBaselineDays?: number;
  hrPaceToleranceSecKm?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const LAST_SIMILAR_WINDOW_DAYS = 30;

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T');
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function median(values: number[]): number | null {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** Efficiency Factor is a ~1.2-1.6 ratio, so it needs two decimals to stay meaningful. */
const round2 = (n: number) => Math.round(n * 100) / 100;
const paceOf = (row: HistoryRow): number | null => row.steady_pace_sec_km ?? row.avg_pace_sec_km ?? null;
const hrOf = (row: HistoryRow): number | null => row.steady_heart_rate ?? row.avg_heart_rate ?? null;

/**
 * Builds the personal-baseline context from prior activities. Pure function so
 * the coach engine stays unit-testable without a database.
 */
export function buildCoachContext(
  rows: HistoryRow[],
  current: CurrentRun,
  options: CoachContextOptions = {}
): CoachContext {
  const windowDays = options.windowDays ?? 90;
  const efBaselineDays = options.efBaselineDays ?? 28;
  const hrPaceToleranceSecKm = options.hrPaceToleranceSecKm ?? 20;

  const end = parseTime(current.start_time) ?? Date.now();
  const windowStart = end - windowDays * DAY_MS;
  const prior = (rows || []).filter(row => {
    if (!row || row.id === current.id) return false;
    const t = parseTime(row.start_time);
    return t != null && t < end && t >= windowStart;
  });

  const family: RunFamily = runFamilyOf(current.runType);
  const comparable = current.isTreadmill ? [] : prior.filter(row => !row.is_treadmill && runFamilyOf(row.run_type || 'easy_base') === family);

  const lastSimilar = current.distanceKm > 0 && current.steadyPaceSecKm && current.steadyHr
    ? comparable
        .filter(row => {
          const distanceKm = (row.distance_meters ?? 0) / 1000;
          return row.run_type === current.runType &&
            (parseTime(row.start_time) ?? 0) >= end - LAST_SIMILAR_WINDOW_DAYS * DAY_MS &&
            distanceKm > 0 && Math.abs(distanceKm - current.distanceKm) / current.distanceKm <= 0.25 &&
            (paceOf(row) ?? 0) > 0 && (hrOf(row) ?? 0) > 0;
        })
        .sort((a, b) => (parseTime(b.start_time) ?? 0) - (parseTime(a.start_time) ?? 0))[0]
    : null;

  // --- Running economy versus the athlete's own 28-day baseline ---
  const efCutoff = end - efBaselineDays * DAY_MS;
  const recentEf = comparable
    .filter(row => (parseTime(row.start_time) ?? 0) >= efCutoff)
    .map(row => row.efficiency_factor)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const baselineEf = recentEf.length >= 2 ? median(recentEf) : null;
  const efDeltaPct = baselineEf && current.efficiencyFactor
    ? round1(((current.efficiencyFactor - baselineEf) / baselineEf) * 100)
    : null;

  // --- Heart-rate cost at a comparable pace (real aerobic fitness signal) ---
  const pace = current.steadyPaceSecKm;
  const hrSamples = pace
    ? comparable
        .filter(row => {
          const p = paceOf(row);
          return p != null && Math.abs(p - pace) <= hrPaceToleranceSecKm && (hrOf(row) ?? 0) > 0;
        })
        .map(row => hrOf(row) as number)
    : [];
  const baselineHrAtPace = hrSamples.length >= 3 ? median(hrSamples) : null;
  const hrAtPaceDeltaBpm = baselineHrAtPace != null && current.steadyHr
    ? Math.round(current.steadyHr - baselineHrAtPace)
    : null;

  // --- Relative standing: aerobic decoupling across the window ---
  const windowDecoupling = comparable
    .map(row => row.aerobic_decoupling_pct)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  let decouplingRank: number | null = null;
  let decouplingSamples = windowDecoupling.length;
  let decouplingBestPct: number | null = null;
  if (current.decouplingPct != null && windowDecoupling.length >= 3) {
    const pool = [...windowDecoupling, current.decouplingPct];
    const sorted = [...pool].sort((a, b) => a - b);
    decouplingRank = sorted.indexOf(current.decouplingPct) + 1;
    decouplingBestPct = round1(sorted[0]);
    decouplingSamples = pool.length;
  }

  // --- Volume milestone ---
  const distances = comparable
    .map(row => (row.distance_meters || 0) / 1000)
    .filter(v => v > 0);
  const longestDistanceKm = distances.length >= 3 ? round1(Math.max(...distances)) : null;
  const isLongestRun = !!longestDistanceKm && current.distanceKm > longestDistanceKm && current.distanceKm >= 10 && comparable.length >= 3;

  // --- Acute:chronic load ratio (7-day against 28-day weekly average) ---
  const acuteCutoff = end - 7 * DAY_MS;
  const chronicCutoff = end - 28 * DAY_MS;
  let acute7DayLoad = 0;
  let chronic28DayLoad = 0;
  for (const row of prior) {
    const load = row.training_load;
    if (typeof load !== 'number' || !Number.isFinite(load) || load <= 0) continue;
    const t = parseTime(row.start_time);
    if (t == null) continue;
    if (t >= acuteCutoff) acute7DayLoad += load;
    if (t >= chronicCutoff) chronic28DayLoad += load;
  }
  const chronicWeeklyLoad = chronic28DayLoad > 0 ? round1(chronic28DayLoad / 4) : null;
  const acwr = chronicWeeklyLoad && chronicWeeklyLoad >= 20
    ? round1(acute7DayLoad / chronicWeeklyLoad)
    : null;

  return {
    windowDays,
    runFamily: family,
    comparableRuns: comparable.length,
    lastSimilarRun: lastSimilar ? {
      id: lastSimilar.id,
      startTime: lastSimilar.start_time,
      distanceKm: round1((lastSimilar.distance_meters ?? 0) / 1000),
      paceSecKm: paceOf(lastSimilar) as number,
      heartRate: Math.round(hrOf(lastSimilar) as number)
    } : null,
    currentHeartRate: current.steadyHr != null && current.steadyHr > 0 ? Math.round(current.steadyHr) : null,
    baselineEf: baselineEf != null ? round2(baselineEf) : null,
    efDeltaPct,
    baselineEfSamples: recentEf.length,
    baselineHrAtPace: baselineHrAtPace != null ? Math.round(baselineHrAtPace) : null,
    hrAtPaceDeltaBpm,
    hrAtPaceSamples: hrSamples.length,
    currentPaceSecKm: pace,
    decouplingRank,
    decouplingSamples,
    decouplingBestPct,
    longestDistanceKm,
    isLongestRun,
    acute7DayLoad: acute7DayLoad > 0 ? Math.round(acute7DayLoad) : null,
    chronicWeeklyLoad,
    acwr
  };
}

/**
 * Turns the numeric context into coach-voice sentences. Only signals that are
 * genuinely meaningful are surfaced; silent metrics stay silent.
 */
export function buildContextInsights(ctx: CoachContext | null | undefined): CoachInsight[] {
  if (!ctx) return [];
  const insights = createInsightLog();

  // 1. Training load context (explains why today felt the way it did)
  if (ctx.acwr != null) {
    const ratio = coachMessage("fragment.x_your_28_day_weekly_average", { p0: ctx.acwr });
    if (ctx.acwr >= 1.5) {
      insights.add('negative', coachMessage("insight.training_load_context_your_7_day_load_is", { p0: ratio }));
    } else if (ctx.acwr >= 1.3) {
      insights.add('caution', coachMessage("insight.training_load_context_your_7_day_load_is_2", { p0: ratio }));
    } else if (ctx.acwr < 0.8) {
      insights.add('neutral', coachMessage("insight.training_load_context_your_7_day_load_is_3", { p0: ratio }));
    } else {
      insights.add('positive', coachMessage("insight.training_load_context_your_7_day_load_is_4", { p0: ratio }));
    }
  }

  // 2. Running economy against the athlete's own baseline
  if (ctx.efDeltaPct != null && ctx.baselineEf != null && Math.abs(ctx.efDeltaPct) >= 2) {
    if (ctx.efDeltaPct > 0) {
      insights.add('positive', coachMessage("insight.personal_baseline_running_economy_reached_ef_above_your", { p0: ctx.baselineEf, p1: ctx.efDeltaPct, p2: ctx.baselineEfSamples }));
    } else {
      insights.add('caution', coachMessage("insight.personal_baseline_running_economy_came_in_below_your", { p0: Math.abs(ctx.efDeltaPct), p1: ctx.baselineEf }));
    }
  }

  // 3. Heart-rate cost at a comparable pace
  // A quality workout's session average mixes work, recovery and late drift.
  // It cannot support a same-pace heart-rate claim about the work intervals.
  if (ctx.runFamily === 'aerobic' && ctx.hrAtPaceDeltaBpm != null && ctx.baselineHrAtPace != null && Math.abs(ctx.hrAtPaceDeltaBpm) >= 2) {
    const paceText = ctx.currentPaceSecKm ? formatPaceText(ctx.currentPaceSecKm) : coachMessage("fragment.this_pace");
    if (ctx.hrAtPaceDeltaBpm < 0) {
      insights.add('positive', coachMessage("insight.pace_specific_cost_usually_costs_you_bpm_across", { p0: paceText, p1: ctx.baselineHrAtPace, p2: ctx.hrAtPaceSamples, p3: Math.abs(ctx.hrAtPaceDeltaBpm) }));
    } else {
      insights.add('caution', coachMessage("insight.pace_specific_cost_usually_costs_you_bpm_across_2", { p0: paceText, p1: ctx.baselineHrAtPace, p2: ctx.hrAtPaceSamples, p3: ctx.hrAtPaceDeltaBpm }));
    }
  }

  // 4. Relative standing across the athlete's own history
  if (ctx.decouplingRank != null && ctx.decouplingSamples >= 4) {
    const bestNote = ctx.decouplingBestPct != null && ctx.decouplingBestPct > 0 ? coachMessage("fragment.best_drift", { p0: ctx.decouplingBestPct }) : '';
    if (ctx.decouplingRank === 1) {
      insights.add('positive', coachMessage("insight.relative_standing_this_was_your_most_stable_aerobic", { p0: ctx.decouplingSamples }));
    } else {
      insights.add('neutral', coachMessage("insight.relative_standing_aerobic_stability_ranks_of_your_last", { p0: ctx.decouplingRank, p1: ctx.decouplingSamples, p2: bestNote }));
    }
  }

  // 5. Volume milestone
  if (ctx.isLongestRun && ctx.longestDistanceKm != null) {
    insights.add('positive', coachMessage("insight.volume_milestone_at_km_this_is_your_longest", { p0: ctx.longestDistanceKm, p1: ctx.windowDays }));
  }

  return insights.items;
}

/**
 * Reads the athlete's recent history for one activity and builds its context.
 * Returns null (never throws) when history is unavailable, so ingestion and
 * startup migrations cannot fail because of a comparison query.
 */
export function loadCoachHistoryContext(
  db: Database.Database,
  activity: Activity,
  options: CoachContextOptions = {}
): CoachContext | null {
  if (!db || !activity || !activity.start_time) return null;
  try {
    const columns = db.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>;
    const environment = columns.some(column => column.name === 'is_treadmill') ? 'is_treadmill' : '0 AS is_treadmill';
    const rows = db.prepare(`
      SELECT id, start_time, run_type, ${environment}, distance_meters, duration_seconds, efficiency_factor,
             aerobic_decoupling_pct, avg_cadence, avg_heart_rate,
             steady_heart_rate, avg_pace_sec_km, steady_pace_sec_km, training_load
      FROM activities
      WHERE start_time < ?
      ORDER BY start_time DESC
      LIMIT 400
    `).all(String(activity.start_time)).map(activityFromRow);

    if (!rows || rows.length === 0) return null;

    const current: CurrentRun = {
      isTreadmill: activity.is_treadmill,
      id: String(activity.id),
      start_time: String(activity.start_time),
      runType: activity.run_type || 'easy_base',
      distanceKm: (activity.distance_meters || 0) / 1000,
      efficiencyFactor: activity.efficiency_factor ?? null,
      decouplingPct: activity.aerobic_decoupling_pct ?? null,
      steadyPaceSecKm: activity.steady_pace_sec_km ?? activity.avg_pace_sec_km ?? null,
      steadyHr: activity.steady_heart_rate ?? activity.avg_heart_rate ?? null
    };

    return buildCoachContext(rows, current, options);
  } catch {
    return null;
  }
}
