import type Database from 'better-sqlite3';
import { loadAnalysisRecords } from '../db/analysis-records.js';
import { MAX_OBSERVED_GAP_SECONDS, observedIntervals, sameTimerSegment } from './time-series.js';
import type { ActivityRecord } from '../domain/telemetry.js';
import { AEROBIC_HISTORY_DAYS, assessAerobicEvidence, type AerobicAssessment,
  type AerobicObservation } from '../../shared/aerobic-assessment.js';
import { thresholdTime } from '../../shared/threshold-trend.js';

type Interval = ReturnType<typeof observedIntervals<ActivityRecord>>[number];
const SETTLE_SECONDS = 60;
const WARMUP_SECONDS = 600;
const MIN_CONTINUOUS_SECONDS = 1800;
const MIN_ASSISTED_BOUT_SECONDS = 300;

function measure(pairs: Interval[], from: number, to: number) {
  let seconds = 0, distance = 0, beats = 0, squares = 0, terrain = 0;
  for (const i of pairs) {
    const start = Math.max(from, i.from), end = Math.min(to, i.to);
    if (end <= start) continue;
    const speed = (at: number) => i.a.speedMps! + (i.b.speedMps! - i.a.speedMps!) * (at - i.from) / i.seconds;
    const hr = (at: number) => i.a.heartRate! + (i.b.heartRate! - i.a.heartRate!) * (at - i.from) / i.seconds;
    const duration = end - start, v = (speed(start) + speed(end)) / 2;
    seconds += duration; distance += v * duration; beats += (hr(start) + hr(end)) / 2 * duration;
    squares += v * v * duration;
    if (i.a.altitudeMeters != null && i.b.altitudeMeters != null)
      terrain += Math.abs(i.b.altitudeMeters - i.a.altitudeMeters) * duration / i.seconds;
  }
  const meanSpeed = distance / seconds;
  return { seconds, hr: beats / seconds, pace: 1000 / meanSpeed, ef: distance / beats,
    cv: Math.sqrt(Math.max(0, squares / seconds - meanSpeed ** 2)) / meanSpeed,
    terrain: terrain / (distance / 1000) };
}

/** Examine whole bouts, including their early HR response; never mine a late plateau. */
export function extractAerobicObservation(records: ActivityRecord[], activityId: string,
  date: string): AerobicObservation | null {
  const end = records.at(-1)?.elapsedSeconds ?? 0;
  const intervals = observedIntervals(records, r => r.elapsedSeconds);
  const running = intervals.filter(i => i.a.speedMps != null && i.b.speedMps != null &&
    i.a.speedMps > 1.5 && i.b.speedMps > 1.5 && i.a.speedMps < 8.5 && i.b.speedMps < 8.5 &&
    i.a.heartRate! > 40 && i.b.heartRate! > 40 && i.a.heartRate! < 240 && i.b.heartRate! < 240);
  const bouts: Interval[][] = [];
  let current: Interval[] = [];
  for (const pair of running) {
    if (current.length && current.at(-1)!.to !== pair.from) { bouts.push(current); current = []; }
    current.push(pair);
  }
  if (current.length) bouts.push(current);
  const settled = bouts.flatMap(pairs => {
    const from = Math.max(WARMUP_SECONDS, pairs[0].from) + SETTLE_SECONDS;
    const to = Math.min(end - WARMUP_SECONDS, pairs.at(-1)!.to);
    if (to - from < MIN_ASSISTED_BOUT_SECONDS) return [];
    const whole = measure(pairs, from, to);
    const first = measure(pairs, from, (from + to) / 2), last = measure(pairs, (from + to) / 2, to);
    const drift = 100 * (1 - last.ef / first.ef);
    if (whole.cv > 0.10 || whole.terrain > 30) return [];
    return [{ pairs, from, to, whole, drift }];
  });
  const continuous = settled.filter(b => b.whole.seconds >= MIN_CONTINUOUS_SECONDS && b.drift >= -8 && b.drift <= 5 &&
    !settled.some(earlier => earlier.from < b.from && Math.abs(earlier.whole.pace / b.whole.pace - 1) <= 0.03 &&
      100 * (1 - b.whole.ef / earlier.whole.ef) > 5))
    .sort((a, b) => b.whole.seconds - a.whole.seconds)[0];
  if (continuous) return { activityId, date, hr: continuous.whole.hr, paceSecKm: continuous.whole.pace,
    runningSeconds: continuous.whole.seconds, decouplingPct: continuous.drift, basis: 'continuous' };
  // Match whole settled bouts at a similar speed. Recovery-assisted evidence
  // describes supported performance, not uninterrupted threshold confirmation.
  if (settled.length < 2) return null;
  const groups = settled.flatMap(anchor => {
    const comparable = settled.filter(b => Math.abs(b.whole.pace / anchor.whole.pace - 1) <= 0.03);
    if (comparable.length < 2 || comparable.some(b => b.drift < -8 || b.drift > 5)) return [];
    const from = comparable[0].from, to = comparable.at(-1)!.to;
    const span = records.filter(r => r.elapsedSeconds >= from && r.elapsedSeconds <= to);
    if (span.some((r, index) => r.heartRate == null || r.speedMps == null || index > 0 &&
      (r.elapsedSeconds - span[index - 1].elapsedSeconds > MAX_OBSERVED_GAP_SECONDS || !sameTimerSegment(span[index - 1], r)))) return [];
    const covered = intervals.reduce((s, i) => s + Math.max(0, Math.min(to, i.to) - Math.max(from, i.from)), 0);
    if (covered < (to - from) * 0.98 || records.some(r => r.elapsedSeconds >= from && r.elapsedSeconds <= to && r.timerActive === false)) return [];
    const seconds = comparable.reduce((s, b) => s + b.whole.seconds, 0);
    const distance = comparable.reduce((s, b) => s + 1000 * b.whole.seconds / b.whole.pace, 0);
    const beats = comparable.reduce((s, b) => s + b.whole.hr * b.whole.seconds, 0);
    const recoveryFraction = 1 - seconds / (to - from);
    const drift = 100 * (1 - comparable.at(-1)!.whole.ef / comparable[0].whole.ef);
    if (seconds < 900 || recoveryFraction > 0.30 || drift < -8 || drift > 5) return [];
    return [{ seconds, hr: beats / seconds, pace: 1000 * seconds / distance, drift }];
  });
  const strongest = groups.sort((a, b) => b.seconds - a.seconds)[0];
  return strongest ? { activityId, date, hr: strongest.hr, paceSecKm: strongest.pace, runningSeconds: strongest.seconds,
    decouplingPct: strongest.drift, basis: 'run_walk' } : null;
}

const cache = new WeakMap<Database.Database, { revision: string; observations: AerobicObservation[];
  activities: Array<{ id: string; start_time: string }> }>();
export function getAerobicAssessment(db: Database.Database, asOfDate = new Date().toISOString(),
  options: { strictlyBefore?: boolean; excludeActivityId?: string } = {}): AerobicAssessment {
  const ref = thresholdTime(asOfDate);
  const cutoff = ref - AEROBIC_HISTORY_DAYS * 86400000;
  if (!Number.isFinite(ref)) return assessAerobicEvidence([], 0, asOfDate);
  const fromDate = new Date(cutoff - 86400000).toISOString().slice(0, 10);
  const toDate = new Date(ref + 86400000).toISOString().slice(0, 10);
  const revision = `${db.pragma('data_version', { simple: true })}:${(db.prepare('SELECT total_changes() AS n').get() as { n: number }).n}:${fromDate}:${toDate}`;
  let saved = cache.get(db);
  if (db.inTransaction || !saved || saved.revision !== revision) {
    const columns = new Set((db.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(row => row.name));
    // Older/minimal databases cannot establish eligible running observations.
    if (['id', 'start_time', 'sport', 'run_type', 'duration_seconds'].some(name => !columns.has(name)))
      return assessAerobicEvidence([], 0, asOfDate, options);
    const failed = columns.has('manual_failed_workout') ? 'AND COALESCE(manual_failed_workout, 0) = 0' : '';
    const activities = db.prepare(`SELECT id, start_time FROM activities WHERE sport = 'running'
      AND (run_type = 'long_run' OR run_type IN ('easy_base', 'tempo') AND duration_seconds >= 3600) ${failed}
      AND datetime(start_time) BETWEEN datetime(?) AND datetime(?)
      ORDER BY start_time`).all(fromDate, toDate) as Array<{ id: string; start_time: string }>;
    // Cache dates and observations, not an as-of result, so historical reads
    // remain causal and freshness changes without database writes.
    saved = { revision, activities, observations: [] };
    for (const activity of activities) {
      const observation = extractAerobicObservation(loadAnalysisRecords(db, activity.id), activity.id, activity.start_time);
      if (observation) saved.observations.push(observation);
    }
    if (!db.inTransaction) cache.set(db, saved);
  }
  const count = saved.activities.filter(activity => activity.id !== options.excludeActivityId &&
    (options.strictlyBefore ? thresholdTime(activity.start_time) < ref : thresholdTime(activity.start_time) <= ref) &&
    thresholdTime(activity.start_time) >= cutoff).length;
  return assessAerobicEvidence(saved.observations, count, asOfDate, options);
}
