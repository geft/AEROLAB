import type Database from 'better-sqlite3';
import type { ActivityRecord } from '../ingestion/csv-parser.js';
import { loadAnalysisRecords } from '../db/analysis-records.js';
import { getAthleteHeartRateProfile } from './athlete-profile.js';
import { MAX_OBSERVED_GAP_SECONDS, sameTimerSegment } from './time-series.js';
import type { ThresholdEvidenceObservation } from '../../shared/threshold-evidence.js';

interface EvidenceRow {
  id: number; source_activity_id: string | null; source_kind: string; effective_date: string;
  lt1_hr: number | null; lt1_pace_sec_km: number | null;
  lt2_hr: number | null; lt2_pace_sec_km: number | null;
  confidence: number; notes: string | null; run_type: string | null; manual_failed_workout: number | null;
}

/** Require complete running evidence, steady speed and limited drift/terrain. */
export function usableThresholdSegment(records: ActivityRecord[], from: number, to: number): boolean {
  const segment = records.filter(r => r.elapsedSeconds >= from && r.elapsedSeconds <= to);
  if (segment.length < 2 || segment[0].elapsedSeconds > from + MAX_OBSERVED_GAP_SECONDS ||
      segment[segment.length - 1].elapsedSeconds < to - MAX_OBSERVED_GAP_SECONDS) return false;
  let duration = 0, distance = 0, beats = 0, ascent = 0, speedSquares = 0;
  const halves = [{ distance: 0, beats: 0 }, { distance: 0, beats: 0 }];
  const middle = (from + to) / 2;
  for (let i = 1; i < segment.length; i++) {
    const a = segment[i - 1], b = segment[i];
    const dt = b.elapsedSeconds - a.elapsedSeconds;
    if (dt <= 0) continue;
    if (dt > MAX_OBSERVED_GAP_SECONDS || !sameTimerSegment(a, b) || a.timerActive === false || b.timerActive === false ||
      a.speedMps == null || b.speedMps == null || a.heartRate == null || b.heartRate == null ||
      !Number.isFinite(a.speedMps) || !Number.isFinite(b.speedMps) || !Number.isFinite(a.heartRate) || !Number.isFinite(b.heartRate) ||
      a.speedMps <= 1.5 || b.speedMps <= 1.5 || a.speedMps > 8.5 || b.speedMps > 8.5 ||
      a.heartRate <= 40 || b.heartRate <= 40 || a.heartRate >= 240 || b.heartRate >= 240) return false;
    duration += dt;
    const speed = (a.speedMps + b.speedMps) / 2, hr = (a.heartRate + b.heartRate) / 2;
    distance += speed * dt;
    speedSquares += speed * speed * dt;
    beats += hr * dt;
    const firstDt = Math.max(0, Math.min(b.elapsedSeconds, middle) - a.elapsedSeconds);
    halves[0].distance += speed * firstDt; halves[0].beats += hr * firstDt;
    halves[1].distance += speed * (dt - firstDt); halves[1].beats += hr * (dt - firstDt);
    if (a.altitudeMeters != null && b.altitudeMeters != null) ascent += Math.abs(b.altitudeMeters - a.altitudeMeters);
  }
  const driftRatio = (halves[1].distance / halves[1].beats) / (halves[0].distance / halves[0].beats);
  return duration >= (to - from) * 0.95 && distance > 0 && beats > 0 &&
    ascent / (distance / 1000) <= 30 && driftRatio >= 0.962 && driftRatio <= 1.08 &&
    Math.sqrt(Math.max(0, speedSquares / duration - (distance / duration) ** 2)) / (distance / duration) <= 0.10;
}

export function aerobicEvidenceAnchor(db: Database.Database): number {
  const independent = getAthleteHeartRateProfile(db, false);
  const hasProfile = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='athlete_profile'").get();
  const range = (hasProfile ? db.prepare("SELECT lt1_min_hr, lt1_max_hr FROM athlete_profile WHERE id = 'primary'").get() : undefined) as
    { lt1_min_hr: number | null; lt1_max_hr: number | null } | undefined;
  return range?.lt1_min_hr != null && range.lt1_max_hr != null && range.lt1_min_hr <= range.lt1_max_hr &&
    range.lt1_min_hr > independent.restingHr && range.lt1_max_hr < independent.lt2Hr
    ? Math.round((range.lt1_min_hr + range.lt1_max_hr) / 2) : independent.lt1Hr;
}

const cache = new WeakMap<Database.Database, { revision: string; rows: EvidenceRow[]; lt1: ThresholdEvidenceObservation[]; lt2: ThresholdEvidenceObservation[] }>();

/** Reassess saved observations without rewriting the workout history. */
export function thresholdEvidenceObservations(db: Database.Database) {
  const anchor = aerobicEvidenceAnchor(db);
  const revision = `${db.pragma('data_version', { simple: true })}:${(db.prepare('SELECT total_changes() AS n').get() as { n: number }).n}:${anchor}`;
  const cached = cache.get(db);
  if (!db.inTransaction && cached?.revision === revision) return cached;
  const hasThresholds = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='physiological_thresholds'").get();
  const activityColumns = new Set((db.prepare('PRAGMA table_info(activities)').all() as Array<{ name: string }>).map(c => c.name));
  const failedColumn = activityColumns.has('manual_failed_workout') ? 'a.manual_failed_workout' : 'NULL AS manual_failed_workout';
  const rows = (hasThresholds ? db.prepare(`SELECT p.*, a.run_type, ${failedColumn} FROM physiological_thresholds p
    LEFT JOIN activities a ON a.id=p.source_activity_id ORDER BY p.effective_date, p.id`).all() : []) as EvidenceRow[];
  const lt1: ThresholdEvidenceObservation[] = [], lt2: ThresholdEvidenceObservation[] = [];
  for (const row of rows) {
    const external = row.source_kind === 'external';
    if (!external && row.manual_failed_workout === 1) continue;
    let records: ActivityRecord[] | undefined;
    const telemetry = () => records ??= row.source_activity_id ? loadAnalysisRecords(db, row.source_activity_id) : [];
    const temperature = () => {
      const values = telemetry().filter(r => r.elapsedSeconds >= 600 && r.elapsedSeconds <= 3600 &&
        r.temperature != null && Number.isFinite(r.temperature)).map(r => r.temperature!).sort((a, b) => a - b);
      return values.length ? values[Math.floor(values.length / 2)] : null;
    };
    const base = { sourceId: external ? `external:${row.id}` : row.source_activity_id ?? `orphan:${row.id}`, external,
      effective_date: row.effective_date, confidence: row.confidence };
    if (row.lt1_hr != null) {
      let usable = false;
      const block = /Cruising Block Km (\d+)-(\d+)/.exec(row.notes ?? '');
      if (!external && row.source_activity_id && block &&
        (row.run_type === 'easy_base' || row.run_type === 'long_run')) {
        const splits = db.prepare('SELECT split_index, duration_seconds, elevation_change_m FROM activity_splits WHERE activity_id=? ORDER BY split_index').all(row.source_activity_id) as
          Array<{ split_index: number; duration_seconds: number; elevation_change_m: number | null }>;
        let elapsed = 0, from = 0, to = 0;
        let flat = true;
        for (const split of splits) {
          if (split.split_index === Number(block[1])) from = elapsed;
          elapsed += split.duration_seconds;
          if (split.split_index === Number(block[2])) to = elapsed;
          if (split.split_index >= Number(block[1]) && split.split_index <= Number(block[2]) && Math.abs(split.elevation_change_m ?? 0) >= 30) flat = false;
        }
        usable = flat && from >= 600 && to <= 3600 && to - from >= 1200 && usableThresholdSegment(telemetry(), from, to);
      }
      lt1.push({ ...base, hr: row.lt1_hr, pace: row.lt1_pace_sec_km, usable, temperatureC: usable ? temperature() : null });
    }
    if (row.lt2_hr != null) {
      let usable = false;
      if (!external && row.source_activity_id && row.run_type === 'threshold_lt2') {
        const intervals = db.prepare('SELECT type, start_seconds, duration_seconds FROM activity_intervals WHERE activity_id=? ORDER BY interval_index').all(row.source_activity_id) as
          Array<{ type: string; start_seconds: number; duration_seconds: number }>;
        const work = intervals.filter(i => i.type === 'work' && i.duration_seconds >= 300 && i.start_seconds >= 300 && i.start_seconds + i.duration_seconds <= 3600);
        const first = work[0], last = work[work.length - 1];
        const longRest = first && last && (intervals.some(i => i.type === 'recovery' && i.start_seconds >= first.start_seconds &&
          i.start_seconds < last.start_seconds && i.duration_seconds > 120) ||
          work.slice(1).some((rep, index) => rep.start_seconds - (work[index].start_seconds + work[index].duration_seconds) > 120));
        let observedWork = 0;
        usable = !longRest && work.length > 0 && work.every(i => {
          if (observedWork >= 1800) return true;
          const duration = Math.min(i.duration_seconds - 90, 1800 - observedWork);
          observedWork += duration;
          return usableThresholdSegment(telemetry(), i.start_seconds + 90, i.start_seconds + 90 + duration);
        }) && observedWork >= 1200;
        // Continuous threshold efforts have no recovery-dependent summary fallback.
        if (!intervals.length) {
          const data = telemetry();
          const start = data.find(r => r.elapsedSeconds >= 600 && (r.heartRate ?? 0) >= row.lt2_hr! - 3)?.elapsedSeconds;
          usable = start != null && start + 1800 <= 3600 && usableThresholdSegment(data, start, start + 1800);
        }
      }
      lt2.push({ ...base, hr: row.lt2_hr, pace: row.lt2_pace_sec_km, usable, temperatureC: usable ? temperature() : null });
    }
  }
  const result = { revision, rows, lt1, lt2 };
  if (!db.inTransaction) cache.set(db, result);
  return result;
}
