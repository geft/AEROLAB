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
/** A comparable window can set the low end of a range without being the anchor. */
const MIN_COMPARABLE_SECONDS = 900;
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
  const eligible = settled.filter(b => b.whole.seconds >= MIN_COMPARABLE_SECONDS && b.drift >= -8 && b.drift <= 5 &&
    !settled.some(earlier => earlier.from < b.from && Math.abs(earlier.whole.pace / b.whole.pace - 1) <= 0.03 &&
      100 * (1 - b.whole.ef / earlier.whole.ef) > 5));
  // The longest bout of a long run is usually its most drifted part, so report
  // the freshest window at comparable pace and keep the higher one as a range
  // instead of averaging drift into a single ceiling value. A shorter
  // comparable window may set the low end, but the effort must still contain a
  // full continuous block.
  const longest = eligible.slice().sort((a, b) => b.whole.seconds - a.whole.seconds)[0];
  const comparable = longest ? eligible.filter(b => Math.abs(b.whole.pace / longest.whole.pace - 1) <= 0.03) : [];
  const freshest = comparable.slice().sort((a, b) => a.whole.hr - b.whole.hr || b.whole.seconds - a.whole.seconds)[0];
  if (freshest && comparable.some(b => b.whole.seconds >= MIN_CONTINUOUS_SECONDS)) {
    const hrHigh = Math.max(...comparable.map(b => b.whole.hr));
    return { activityId, date, hr: freshest.whole.hr, hrHigh: hrHigh > freshest.whole.hr + 0.5 ? hrHigh : undefined,
      paceSecKm: freshest.whole.pace, runningSeconds: freshest.whole.seconds, decouplingPct: freshest.drift,
      basis: 'continuous' };
  }
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

type ObservationMap = Map<string, AerobicObservation | null>;
const cache = new WeakMap<Database.Database, { revision: string; observations: ObservationMap }>();
const batchSnapshots = new WeakMap<Database.Database, ObservationMap>();

type EligibleActivity = { id: string; start_time: string };

function eligibleActivities(db: Database.Database, fromDate: string, toDate: string): EligibleActivity[] {
  const columns = new Set((db.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(row => row.name));
  if (['id', 'start_time', 'sport', 'run_type', 'duration_seconds'].some(name => !columns.has(name))) return [];
  const environment = columns.has('is_treadmill') ? 'AND is_treadmill = 0' : '';
  return db.prepare(`SELECT id, start_time FROM activities WHERE sport = 'running'
    AND (run_type = 'long_run' OR run_type IN ('easy_base', 'tempo') AND duration_seconds >= 3600) ${environment}
    AND datetime(start_time) BETWEEN datetime(?) AND datetime(?) ORDER BY start_time`)
    .all(fromDate, toDate) as EligibleActivity[];
}

/**
 * An observation is a pure function of one activity's telemetry and date, so it
 * outlives the date window that selected it. Eligibility is re-queried every
 * call: run-type edits change which runs count without changing their telemetry.
 */
function collectObservations(db: Database.Database, activities: EligibleActivity[], store: ObservationMap): AerobicObservation[] {
  const observations: AerobicObservation[] = [];
  for (const activity of activities) {
    let observation = store.get(activity.id);
    if (observation === undefined) {
      observation = extractAerobicObservation(loadAnalysisRecords(db, activity.id), activity.id, activity.start_time);
      store.set(activity.id, observation);
    }
    if (observation) observations.push(observation);
  }
  return observations;
}

/** Reuse unchanged telemetry during a synchronous derived-analysis-only batch. */
export function withAerobicEvidenceSnapshot<T>(db: Database.Database, action: () => T): T {
  const previous = batchSnapshots.get(db);
  batchSnapshots.set(db, previous ?? new Map());
  try { return action(); } finally {
    if (previous) batchSnapshots.set(db, previous); else batchSnapshots.delete(db);
  }
}

export function getAerobicAssessment(db: Database.Database, asOfDate = new Date().toISOString(),
  options: { strictlyBefore?: boolean; excludeActivityId?: string } = {}): AerobicAssessment {
  const ref = thresholdTime(asOfDate);
  const cutoff = ref - AEROBIC_HISTORY_DAYS * 86400000;
  if (!Number.isFinite(ref)) return assessAerobicEvidence([], 0, asOfDate);
  const fromDate = new Date(cutoff - 86400000).toISOString().slice(0, 10);
  const toDate = new Date(ref + 86400000).toISOString().slice(0, 10);
  const batch = batchSnapshots.get(db);
  const revision = `${db.pragma('data_version', { simple: true })}:${(db.prepare('SELECT total_changes() AS n').get() as { n: number }).n}`;
  // Observations only survive writes while a batch promises telemetry is still.
  const persistent = !batch && !db.inTransaction;
  const cached = cache.get(db);
  const store = batch ?? (persistent && cached?.revision === revision ? cached.observations : new Map());
  if (persistent && store !== cached?.observations) cache.set(db, { revision, observations: store });
  const activities = eligibleActivities(db, fromDate, toDate);
  const observations = collectObservations(db, activities, store);
  const count = activities.filter(activity => activity.id !== options.excludeActivityId &&
    (options.strictlyBefore ? thresholdTime(activity.start_time) < ref : thresholdTime(activity.start_time) <= ref) &&
    thresholdTime(activity.start_time) >= cutoff).length;
  return assessAerobicEvidence(observations, count, asOfDate, options);
}
