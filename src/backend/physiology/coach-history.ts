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
const LAST_SIMILAR_WINDOW_DAYS = 30;

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
  const comparable = prior.filter(row => runFamilyOf(row.run_type || 'easy_base') === family);

  const lastSimilar = current.distanceKm > 0 && current.steadyPaceSecKm && current.steadyHr
    ? prior
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
  if (!ctx || ctx.comparableRuns < 2) return [];
  const insights = createInsightLog();

  // 1. Training load context (explains why today felt the way it did)
  if (ctx.acwr != null) {
    const ratio = `${ctx.acwr}x your 28-day weekly average`;
    if (ctx.acwr >= 1.5) {
      insights.add('negative', `Training Load Context: your 7-day load is ${ratio} — a high-risk spike. Any pace loss or heart-rate rise today reflects accumulated fatigue, not lost fitness, so keep the next 3 days genuinely easy.`);
    } else if (ctx.acwr >= 1.3) {
      insights.add('caution', `Training Load Context: your 7-day load is ${ratio} and ramping fast. Expect elevated heart rate at easy pace until this block is absorbed.`);
    } else if (ctx.acwr < 0.8) {
      insights.add('neutral', `Training Load Context: your 7-day load is ${ratio} — a deload window. Fresher legs here explain a faster pace at the same heart rate.`);
    } else {
      insights.add('positive', `Training Load Context: your 7-day load is ${ratio}, inside the productive 0.8-1.3 tunnel, so this session was absorbed on schedule.`);
    }
  }

  // 2. Running economy against the athlete's own baseline
  if (ctx.efDeltaPct != null && ctx.baselineEf != null && Math.abs(ctx.efDeltaPct) >= 2) {
    if (ctx.efDeltaPct > 0) {
      insights.add('positive', `Personal Baseline: running economy reached ${ctx.baselineEf} EF + ${ctx.efDeltaPct}%, above your 28-day median across ${ctx.baselineEfSamples} comparable runs — a real aerobic gain rather than day-to-day noise.`);
    } else {
      insights.add('caution', `Personal Baseline: running economy came in ${Math.abs(ctx.efDeltaPct)}% below your 28-day median of ${ctx.baselineEf} EF. A single session is noise, but two in a row usually means accumulated fatigue.`);
    }
  }

  // 3. Heart-rate cost at a comparable pace
  if (ctx.hrAtPaceDeltaBpm != null && ctx.baselineHrAtPace != null && Math.abs(ctx.hrAtPaceDeltaBpm) >= 2) {
    const paceText = ctx.currentPaceSecKm ? formatPaceText(ctx.currentPaceSecKm) : 'this pace';
    if (ctx.hrAtPaceDeltaBpm < 0) {
      insights.add('positive', `Pace-Specific Cost: ${paceText} usually costs you ${ctx.baselineHrAtPace} bpm across ${ctx.hrAtPaceSamples} comparable runs; today you paid ${Math.abs(ctx.hrAtPaceDeltaBpm)} bpm less, a direct sign the aerobic engine is stronger.`);
    } else {
      insights.add('caution', `Pace-Specific Cost: ${paceText} usually costs you ${ctx.baselineHrAtPace} bpm across ${ctx.hrAtPaceSamples} comparable runs; today it cost ${ctx.hrAtPaceDeltaBpm} bpm more, so heat, fuelling or accumulated fatigue is the limiter rather than fitness.`);
    }
  }

  // 4. Relative standing across the athlete's own history
  if (ctx.decouplingRank != null && ctx.decouplingSamples >= 4) {
    const bestNote = ctx.decouplingBestPct != null && ctx.decouplingBestPct > 0
      ? ` (best ${ctx.decouplingBestPct}% drift)`
      : '';
    if (ctx.decouplingRank === 1) {
      insights.add('positive', `Relative Standing: this was your most stable aerobic session across the last ${ctx.decouplingSamples} comparable runs.`);
    } else {
      insights.add('neutral', `Relative Standing: aerobic stability ranks ${ctx.decouplingRank} of your last ${ctx.decouplingSamples} comparable runs${bestNote}.`);
    }
  }

  // 5. Volume milestone
  if (ctx.isLongestRun && ctx.longestDistanceKm != null) {
    insights.add('positive', `Volume Milestone: at ${ctx.longestDistanceKm} km this is your longest comparable run in the last ${ctx.windowDays} days, extending your endurance ceiling.`);
  }

  return insights.items;
}

/**
 * Reads the athlete's recent history for one activity and builds its context.
 * Returns null (never throws) when history is unavailable, so ingestion and
 * startup migrations cannot fail because of a comparison query.
 */
export function loadCoachHistoryContext(
  db: any,
  activity: any,
  options: CoachContextOptions = {}
): CoachContext | null {
  if (!db || !activity || !activity.start_time) return null;
  try {
    const rows = db.prepare(`
      SELECT id, start_time, run_type, distance_meters, efficiency_factor,
             aerobic_decoupling_pct, avg_cadence, avg_heart_rate,
             steady_heart_rate, avg_pace_sec_km, steady_pace_sec_km, training_load
      FROM activities
      WHERE start_time < ?
      ORDER BY start_time DESC
      LIMIT 400
    `).all(String(activity.start_time)) as HistoryRow[];

    if (!rows || rows.length === 0) return null;

    const current: CurrentRun = {
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
