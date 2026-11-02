import { decodeStoredJson } from './compression.js';
/** Analysis does not need the much larger raw FIT JSON saved for export. */
export const ANALYSIS_RECORD_COLUMNS = 'timestamp, elapsed_seconds, heart_rate, cadence, speed_mps, distance_m, altitude_m, lat, lon, temp, vert_osc, stance_time, step_length_m, vertical_ratio, stance_time_balance, power_w, respiration_rate, core_temperature_c, fractional_cadence';

import type Database from 'better-sqlite3';
import type { ActivityRecord } from '../domain/telemetry.js';
import { objectRow } from './rows.js';
import { prepareFitAnalysis } from '../ingestion/fit-analysis.js';
import { repairSpeedTelemetry } from '../domain/repair-speed.js';

/** The only SQLite-to-domain telemetry adapter. Validate every sensor field. */
export function analysisRecordFromRow(value: unknown): ActivityRecord {
  const row = objectRow(value, 'activity_records');
  const number = (key: string): number | null => {
    const value = row[key];
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid activity_records.${key}`);
    return value;
  };
  const elapsedSeconds = number('elapsed_seconds');
  if (elapsedSeconds == null) throw new Error('Invalid activity_records.elapsed_seconds');
  if (row.timestamp != null && typeof row.timestamp !== 'string') throw new Error('Invalid activity_records.timestamp');
  return {
    timestamp: row.timestamp as string ?? '', elapsedSeconds,
    heartRate: number('heart_rate'), cadence: number('cadence'), speedMps: number('speed_mps'),
    distanceMeters: number('distance_m'), altitudeMeters: number('altitude_m'), latitude: number('lat'), longitude: number('lon'),
    temperature: number('temp'), verticalOscillation: number('vert_osc'), stanceTime: number('stance_time'),
    stepLength: number('step_length_m'), verticalRatio: number('vertical_ratio'), stanceTimeBalance: number('stance_time_balance'),
    power: number('power_w'), respirationRate: number('respiration_rate'), coreTemperature: number('core_temperature_c'), fractionalCadence: number('fractional_cadence')
  };
}

/** Existing wire consumers keep snake_case; timer annotations remain analysis-only. */
export function analysisRecordToRow(r: ActivityRecord) {
  return {
    timestamp: r.timestamp, elapsed_seconds: r.elapsedSeconds, heart_rate: r.heartRate,
    cadence: r.cadence, speed_mps: r.speedMps, distance_m: r.distanceMeters, altitude_m: r.altitudeMeters,
    lat: r.latitude, lon: r.longitude, temp: r.temperature, vert_osc: r.verticalOscillation, stance_time: r.stanceTime,
    step_length_m: r.stepLength, vertical_ratio: r.verticalRatio, stance_time_balance: r.stanceTimeBalance,
    power_w: r.power, respiration_rate: r.respirationRate, core_temperature_c: r.coreTemperature, fractional_cadence: r.fractionalCadence,
    timerActive: r.timerActive, timerSegment: r.timerSegment, timerPauseSeconds: r.timerPauseSeconds
  };
}

type RecordBatch = { samples: number; entries: Map<string, ActivityRecord[]> };
/** Decoding is the expensive part of every derived-metric pass, so a batch may reuse it. */
const batchRecords = new WeakMap<Database.Database, RecordBatch>();
const MAX_BATCH_SAMPLES = 200_000;

/**
 * Reuse decoded telemetry for the duration of one synchronous batch. The caller
 * promises the batch does not write `activity_records` or `activity_fit_details`
 * — replay, recalibration and coaching re-sync all satisfy that. Entries are
 * bounded, so a long batch cannot accumulate the whole history.
 */
export function withAnalysisRecordCache<T>(db: Database.Database, action: () => T): T {
  const previous = batchRecords.get(db);
  const batch = previous ?? { samples: 0, entries: new Map<string, ActivityRecord[]>() };
  batchRecords.set(db, batch);
  try {
    return action();
  } finally {
    if (previous) batchRecords.set(db, previous); else batchRecords.delete(db);
  }
}

export function loadAnalysisRecords(db: Database.Database, activityId: string): ActivityRecord[] {
  const batch = batchRecords.get(db);
  const cached = batch?.entries.get(activityId);
  if (cached) {
    // Refresh recency without copying the decoded records themselves.
    batch!.entries.delete(activityId);
    batch!.entries.set(activityId, cached);
    // Callers own their array; the record objects are treated as immutable.
    return cached.slice();
  }
  // Legacy snapshots can predate optional FIT columns and the metadata table.
  const columns = new Set((db.prepare('PRAGMA table_info(activity_records)').all() as Array<{ name: string }>).map(row => row.name));
  const selection = ANALYSIS_RECORD_COLUMNS.split(', ').map(column => columns.has(column) ? column : `NULL AS ${column}`).join(', ');
  const records = db.prepare(`SELECT ${selection} FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC`).all(activityId).map(analysisRecordFromRow);
  const hasFit = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='activity_fit_details'").get();
  const fit = hasFit ? db.prepare('SELECT metadata_json FROM activity_fit_details WHERE activity_id = ?').get(activityId) as { metadata_json: string | Buffer } | undefined : undefined;
  const decoded = repairSpeedTelemetry(prepareFitAnalysis(records, fit ? JSON.parse(decodeStoredJson(fit.metadata_json)) : undefined).records);
  if (batch) {
    batch.entries.set(activityId, decoded);
    batch.samples += decoded.length;
    for (const [id, value] of batch.entries) {
      if (batch.samples <= MAX_BATCH_SAMPLES || batch.entries.size <= 1) break;
      batch.entries.delete(id);
      batch.samples -= value.length;
    }
    return decoded.slice();
  }
  return decoded;
}
