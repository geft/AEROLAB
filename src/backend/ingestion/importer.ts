import { decodeStoredJson, compressActivity } from '../db/compression.js';
import { isTreadmillFitMetadata } from '../../shared/activity-environment.js';
import { persistWorkoutSegments } from '../db/workout-segments.js';
import { assertDatabaseWritable } from '../application/database-operations.js';
import { analyzeWorkout, prepareAnalysisContext } from '../application/analysis/analyze-workout.js';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { parseRunCSV, type ParsedCSV } from './csv-parser';
import { parseRunFit, isFitBuffer, isZipBuffer } from './fit-parser.js';
import type { EconomyMetrics, SplitLap } from '../physiology/economy.js';
import { evaluateThresholdUpdate, getStridePaceAnchorSecKmAtDate, getHeartRateProfileAtDate } from '../physiology/threshold-tracker.js';
import { affectedActivityIds, rebuildAffectedHistory } from '../application/analysis/rebuild-history.js';
import { thresholdTime } from '../../shared/threshold-trend.js';
import { syncActivityCoachSummary } from '../physiology/coach-summary.js';
import { calculateActivityTrainingLoad } from '../physiology/training-load.js';

export interface ImportResult {
  status: 'imported' | 'skipped_duplicate' | 'skipped_non_running' | 'error';
  activityId?: string;
  name?: string;
  date?: string;
  runType?: string;
  distanceKm?: number;
  durationMin?: number;
  efficiencyFactor?: number | null;
  aerobicDecouplingPct?: number | null;
  intervalsDetected?: number;
  reason?: string;
  error?: string;
}

export interface ImportOptions {
  force?: boolean;
  precomputed?: { economy: EconomyMetrics; splits: SplitLap[] };
  /** Internal batch context: replay history only after all files are stored. */
  deferredReplay?: { earliestTime: number; precomputed: Map<string, { economy: EconomyMetrics; splits: SplitLap[] }> };
}
export type PreparedRun = ParsedCSV & { precomputed?: { economy: EconomyMetrics; splits: SplitLap[] } };

export function importRunFile(db: Database.Database, filePath: string, options: ImportOptions = {}): ImportResult {
  try {
    if (!fs.existsSync(filePath)) {
      return { status: 'error', error: `File not found: ${filePath}` };
    }

    const filename = path.basename(filePath);
    const buffer = fs.readFileSync(filePath);

    // Auto-detect algorithm: Garmin FIT binary vs standard CSV
    if (isFitBuffer(buffer) || isZipBuffer(buffer) || /\.(fit|zip)$/i.test(filename)) {
      const fitResult = parseRunFit(buffer, filename);
      if (!fitResult) {
        return {
          status: 'skipped_non_running',
          reason: 'FIT file is not a supported running session (e.g. daily wellness, sleep, or non-running activity)'
        };
      }
      return importParsedRun(db, fitResult, filename, options);
    }

    const content = buffer.toString('utf8');
    return importRunContent(db, content, filename, options);
  } catch (err: any) {
    return { status: 'error', error: err.message };
  }
}

export function importRunContent(
  db: Database.Database,
  content: string,
  filename: string,
  options: ImportOptions = {}
): ImportResult {
  try {
    return importParsedRun(db, parseRunCSV(content, filename), filename, options);
  } catch (err: any) {
    return { status: 'error', error: err.message };
  }
}

export function importParsedRun(db: Database.Database, parsed: ParsedCSV, filename: string, options: ImportOptions = {}): ImportResult {
  assertDatabaseWritable();
  try {
    const { fileHash, records } = parsed;
    const metadata = { ...parsed.metadata };

    if (!records || records.length === 0) {
      return { status: 'error', error: 'CSV file contains no valid records' };
    }
    if (!Number.isFinite(metadata.totalDistanceMeters) || metadata.totalDistanceMeters < 0 ||
        !Number.isFinite(metadata.totalDurationSeconds) || metadata.totalDurationSeconds < 0 ||
        records.some(record => !Number.isFinite(record.elapsedSeconds) ||
          (record.latitude !== null && (record.latitude < -90 || record.latitude > 90)) ||
          (record.longitude !== null && (record.longitude < -180 || record.longitude > 180)))) {
      return { status: 'error', error: 'Run contains invalid distance, duration, time, or coordinates' };
    }

  // 1. Check for duplicate via hash OR matching activity ID
  let existing = db.prepare('SELECT id, source_file_hash, name, start_time FROM activities WHERE source_file_hash = ? OR id = ?').get(fileHash, metadata.id) as { id: string; source_file_hash: string; name?: string; start_time: string } | undefined;

  // 1b. Check for duplicate via physical workout signature (start time within 60s and distance within 150m)
  if (!existing && metadata.date && metadata.totalDistanceMeters != null) {
    try {
      const match = db.prepare(`
        SELECT id, source_file_hash, name, start_time FROM activities
        WHERE abs(strftime('%s', start_time) - strftime('%s', ?)) <= 60
          AND abs(distance_meters - ?) <= 150
        LIMIT 1
      `).get(metadata.date, metadata.totalDistanceMeters) as { id: string; source_file_hash: string; name?: string; start_time: string } | undefined;
      if (match) {
        existing = match;
      }
    } catch {
      // Ignore if table schema or strftime fallback
    }
  }

  if (existing && !options.force) {
    return {
      status: 'skipped_duplicate',
      activityId: existing.id,
      name: metadata.name,
      date: metadata.date
    };
  }

  // 2. Compute Physiology & Intervals
  const confirmed = existing ? db.prepare('SELECT manual_run_type, manual_failed_workout FROM activities WHERE id = ?').get(existing.id) as
    { manual_run_type: import('./classifier.js').RunType | null; manual_failed_workout: number | null } : undefined;
  const storedFit = existing && !parsed.fitMetadata ? db.prepare('SELECT metadata_json FROM activity_fit_details WHERE activity_id = ?')
    .get(existing.id) as { metadata_json: string | Buffer } | undefined : undefined;
  const fitMetadata = parsed.fitMetadata ?? (storedFit ? JSON.parse(decodeStoredJson(storedFit.metadata_json)) : undefined);
  metadata.isTreadmill = isTreadmillFitMetadata(fitMetadata);
  const hrProfile = getHeartRateProfileAtDate(db, metadata.date, existing?.id ?? metadata.id);
  const stridePaceAnchorSecKm = getStridePaceAnchorSecKmAtDate(db, metadata.date, existing?.id ?? metadata.id);
  const context = prepareAnalysisContext({ metadata, rawRecords: records,
    fitMetadata,
    historicalProfile: hrProfile, stridePaceAnchorSecKm });
  const { economy, splits, classification, runType, intervals, tags: initialTags } = analyzeWorkout(context, {
    confirmedRunType: confirmed?.manual_run_type, precomputed: options.precomputed
  });

  // 3. Compute Averages from records
  let tempSum = 0, tempCount = 0;
  let vertSum = 0, vertCount = 0;
  let stanceSum = 0, stanceCount = 0;

  for (const r of records) {
    if (r.temperature !== null) { tempSum += r.temperature; tempCount++; }
    if (r.verticalOscillation !== null) { vertSum += r.verticalOscillation; vertCount++; }
    if (r.stanceTime !== null) { stanceSum += r.stanceTime; stanceCount++; }
  }

  const avgTemp = tempCount > 0 ? Number((tempSum / tempCount).toFixed(1)) : null;
  const avgVertOsc = vertCount > 0 ? Number((vertSum / vertCount).toFixed(1)) : null;
  const avgStance = stanceCount > 0 ? Number((stanceSum / stanceCount).toFixed(1)) : null;

  // Average pace in sec/km
  const avgPaceSecKm = metadata.totalDistanceMeters > 0
    ? Math.round((metadata.totalDurationSeconds / metadata.totalDistanceMeters) * 1000)
    : null;

  // 4. Ingest into Database in a Transaction
  const insertActivity = db.prepare(`
    INSERT INTO activities (
      id, source_filename, source_file_hash, start_time, name, sport, is_treadmill,
      run_type, auto_run_type, distance_meters, duration_seconds, elapsed_seconds,
      avg_pace_sec_km, avg_heart_rate, max_heart_rate, avg_cadence, max_cadence,
      calories, elevation_gain_m, elevation_loss_m, avg_temperature,
      avg_vertical_oscillation, avg_stance_time, efficiency_factor,
      aerobic_decoupling_pct, meters_per_beat, workout_lat, workout_lon,
      steady_pace_sec_km, steady_heart_rate, steady_cadence, steady_stance_time,
      pause_duration_seconds, walk_duration_seconds, walk_distance_meters,
      tags,
      training_load, z1_seconds, z2_seconds, z3_seconds, z4_seconds, z5_seconds
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?,
      ?, ?, ?, ?, ?, ?
    )
  `);

  const insertRecord = db.prepare(`
    INSERT INTO activity_records (
      activity_id, timestamp, elapsed_seconds, heart_rate, cadence,
      speed_mps, distance_m, altitude_m, lat, lon, temp, vert_osc, stance_time,
      power_w, vertical_ratio, stance_time_balance, step_length_m,
      respiration_rate, core_temperature_c, fractional_cadence, fit_fields_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Compute geographic centroid of the core workout segment (excluding warmup and cooldown)
  // This provides accurate microclimate weather (e.g. riverside PCN vs urban HDB block) while shielding home location.
  let workoutLat: number | null = null;
  let workoutLon: number | null = null;
  const warmupCutoffSec = Math.min(300, metadata.totalDurationSeconds * 0.2);
  const cooldownCutoffSec = Math.max(warmupCutoffSec, metadata.totalDurationSeconds - Math.min(300, metadata.totalDurationSeconds * 0.15));
  
  const coreRecords = records.filter(
    r => r.elapsedSeconds >= warmupCutoffSec && 
         r.elapsedSeconds <= cooldownCutoffSec && 
         r.latitude !== null && 
         r.longitude !== null
  );

  const targetRecords = coreRecords.length > 0 
    ? coreRecords 
    : records.filter(r => r.latitude !== null && r.longitude !== null);

  if (targetRecords.length > 0) {
    const sumLat = targetRecords.reduce((sum, r) => sum + (r.latitude as number), 0);
    const sumLon = targetRecords.reduce((sum, r) => sum + (r.longitude as number), 0);
    workoutLat = Number((sumLat / targetRecords.length).toFixed(6));
    workoutLon = Number((sumLon / targetRecords.length).toFixed(6));
  }

  const pb = economy.pauseBreakdown;

  const loadResult = calculateActivityTrainingLoad(
    context.records,
    {
      maxHr: hrProfile.maxHr,
      restingHr: hrProfile.restingHr,
      lt1Hr: hrProfile.lt1Hr,
      lt2Hr: hrProfile.lt2Hr,
      gender: hrProfile.gender
    },
    {
      durationSeconds: metadata.totalDurationSeconds,
      avgHeartRate: metadata.avgHeartRate
    }
  );

  let refreshed: { run_type: string; interval_count: number } | undefined;
  const transaction = db.transaction(() => {
    const previousFit = existing && options.force ? db.prepare('SELECT metadata_json, source_fit FROM activity_fit_details WHERE activity_id = ?')
      .get(existing.id) as { metadata_json: string | Buffer; source_fit: Buffer | null } | undefined : undefined;
    // If force re-importing, purge old rows for this activity first
    if (existing && options.force) {
      const targetId = existing.id;
      db.prepare('DELETE FROM activity_splits WHERE activity_id = ?').run(targetId);
      db.prepare('DELETE FROM activity_intervals WHERE activity_id = ?').run(targetId);
      db.prepare('DELETE FROM activity_records WHERE activity_id = ?').run(targetId);
      db.prepare("DELETE FROM physiological_thresholds WHERE source_activity_id = ? AND source_kind = 'workout'").run(targetId);
      db.prepare('DELETE FROM activity_coach_summaries WHERE activity_id = ?').run(targetId);
      db.prepare('DELETE FROM activities WHERE id = ?').run(targetId);
    }
    insertActivity.run(
      metadata.id,
      filename,
      fileHash,
      metadata.date,
      metadata.name,
      metadata.sport,
      Number(metadata.isTreadmill),
      runType,
      classification.runType,
      metadata.totalDistanceMeters,
      metadata.totalDurationSeconds,
      metadata.totalElapsedSeconds,
      avgPaceSecKm,
      metadata.avgHeartRate,
      metadata.maxHeartRate,
      metadata.avgCadence,
      metadata.maxCadence,
      metadata.calories,
      metadata.totalAscentMeters,
      metadata.totalDescentMeters,
      avgTemp,
      avgVertOsc,
      avgStance,
      economy.efficiencyFactor,
      economy.aerobicDecouplingPct,
      economy.metersPerBeat,
      workoutLat,
      workoutLon,
      pb?.steadyPaceSecKm ?? avgPaceSecKm,
      pb?.steadyHeartRate ?? metadata.avgHeartRate,
      pb?.steadyCadence ?? metadata.avgCadence,
      pb?.steadyStanceTimeMs ?? avgStance,
      pb?.stopDurationSeconds ?? 0,
      pb?.walkDurationSeconds ?? 0,
      pb?.walkDistanceMeters ?? 0,
      JSON.stringify(initialTags),
      loadResult.trainingLoad,
      loadResult.zones.z1Seconds,
      loadResult.zones.z2Seconds,
      loadResult.zones.z3Seconds,
      loadResult.zones.z4Seconds,
      loadResult.zones.z5Seconds
    );


    if (confirmed) db.prepare('UPDATE activities SET manual_run_type = ?, manual_failed_workout = ? WHERE id = ?')
      .run(confirmed.manual_run_type, confirmed.manual_failed_workout, metadata.id);

    persistWorkoutSegments(db, metadata.id, splits, intervals);

    // Keep every telemetry sample. The workout centroid is enough for weather;
    // store it once so a CSV export can still be reimported with that location.
    for (let index = 0; index < records.length; index++) {
      const r = records[index];
      insertRecord.run(
        metadata.id,
        r.timestamp,
        r.elapsedSeconds,
        r.heartRate,
        r.cadence,
        r.speedMps,
        r.distanceMeters,
        r.altitudeMeters,
        index === 0 ? workoutLat : null,
        index === 0 ? workoutLon : null,
        r.temperature,
        r.verticalOscillation,
        r.stanceTime,
        r.power ?? null, r.verticalRatio ?? null, r.stanceTimeBalance ?? null, r.stepLength ?? null,
        r.respirationRate ?? null, r.coreTemperature ?? null, r.fractionalCadence ?? null,
        r.fitFields ? JSON.stringify(r.fitFields) : null
      );
    }

    const fitMetadataJson = parsed.fitMetadata ? JSON.stringify(parsed.fitMetadata) : previousFit?.metadata_json;
    if (fitMetadataJson) db.prepare(`INSERT INTO activity_fit_details (activity_id, metadata_json, source_fit)
      VALUES (?, ?, ?) ON CONFLICT(activity_id) DO UPDATE SET metadata_json = excluded.metadata_json,
      source_fit = COALESCE(excluded.source_fit, activity_fit_details.source_fit)`)
      .run(metadata.id, fitMetadataJson, parsed.sourceFit ?? previousFit?.source_fit ?? null);

    compressActivity(db, metadata.id);

    // Threshold updates
    if (confirmed?.manual_failed_workout !== 1) evaluateThresholdUpdate(db, metadata.id, metadata.date, runType, metadata, context.records, economy, hrProfile);

    // A backfill or corrected import may change evidence for existing later
    // workouts. Rebuild those in the same transaction so file order cannot
    // leave their labels/zones stale or commit only half of an affected history.
    const ref = Math.min(thresholdTime(metadata.date), thresholdTime(existing?.start_time ?? metadata.date));
    if (options.deferredReplay) options.deferredReplay.earliestTime = Math.min(options.deferredReplay.earliestTime, ref);
    const affected = options.deferredReplay ? [] : affectedActivityIds(db, ref);
    if (affected.some(id => id !== metadata.id) && !options.deferredReplay) {
      rebuildAffectedHistory(db, { fromTime: ref });
      refreshed = db.prepare(`SELECT run_type,(SELECT COUNT(*) FROM activity_intervals WHERE activity_id=activities.id) AS interval_count
        FROM activities WHERE id=?`).get(metadata.id) as { run_type: string; interval_count: number };
    } else if (!options.deferredReplay) {
      // A failed summary must roll back the workout together with its telemetry.
      syncActivityCoachSummary(db, metadata.id, undefined, { classificationEvidence: classification.evidence });
    }
  });

  transaction();
  options.deferredReplay?.precomputed.set(metadata.id, { economy, splits });

    return {
      status: 'imported',
      activityId: metadata.id,
      name: metadata.name,
      date: metadata.date,
      runType: refreshed?.run_type ?? runType,
      distanceKm: Number((metadata.totalDistanceMeters / 1000).toFixed(2)),
      durationMin: Number((metadata.totalDurationSeconds / 60).toFixed(1)),
      efficiencyFactor: economy.efficiencyFactor,
      aerobicDecouplingPct: economy.aerobicDecouplingPct,
      intervalsDetected: refreshed?.interval_count ?? intervals.length
    };
  } catch (err: any) {
    return { status: 'error', error: err.message || 'Failed to parse and import run' };
  }
}

/** Store a bounded batch atomically, then rebuild its affected history once. */
export function importParsedRuns(db: Database.Database, files: Array<{ parsed: ParsedCSV; filename: string }>, options: Pick<ImportOptions, 'force'> = {}): ImportResult[] {
  return importPreparedRuns(db, files.map(file => ({ filename: file.filename, date: file.parsed.metadata.date, load: () => file.parsed })), options);
}

/** Load one decoded file at a time so a full import job has bounded memory. */
export function importPreparedRuns(db: Database.Database, files: Array<{ filename: string; date: string; load: () => PreparedRun }>,
  options: Pick<ImportOptions, 'force'> & { onProgress?: (phase: 'importing' | 'reanalysing', completed: number, total: number) => void } = {}): ImportResult[] {
  assertDatabaseWritable();
  return db.transaction(() => {
    const deferredReplay = { earliestTime: Infinity, precomputed: new Map<string, { economy: EconomyMetrics; splits: SplitLap[] }>() };
    const results: ImportResult[] = new Array(files.length);
    const ordered = files.map((file, index) => ({ ...file, index }))
      .sort((a, b) => thresholdTime(a.date) - thresholdTime(b.date));
    for (const [processed, file] of ordered.entries()) {
      try {
        // A failed file rolls back its own writes without discarding good files.
        results[file.index] = db.transaction(() => {
          const parsed = file.load();
          const result = importParsedRun(db, parsed, file.filename, { force: options.force, deferredReplay, precomputed: parsed.precomputed });
          if (result.status === 'error') throw new Error(result.error);
          return result;
        })();
      } catch (error) {
        results[file.index] = { status: 'error', error: error instanceof Error ? error.message : String(error) };
      }
      options.onProgress?.('importing', processed + 1, files.length);
    }
    if (results.some(result => result.status === 'imported')) {
      const affected = affectedActivityIds(db, deferredReplay.earliestTime);
      options.onProgress?.('reanalysing', 0, affected.length);
      rebuildAffectedHistory(db, { fromTime: deferredReplay.earliestTime, precomputed: deferredReplay.precomputed,
        onProgress: (completed, total) => options.onProgress?.('reanalysing', completed, total) });
      for (const result of results) {
        if (result.status !== 'imported') continue;
        const refreshed = db.prepare(`SELECT run_type, efficiency_factor, aerobic_decoupling_pct,
          (SELECT COUNT(*) FROM activity_intervals WHERE activity_id=activities.id) AS interval_count
          FROM activities WHERE id=?`).get(result.activityId) as
          { run_type: string; efficiency_factor: number | null; aerobic_decoupling_pct: number | null; interval_count: number };
        result.runType = refreshed.run_type;
        result.efficiencyFactor = refreshed.efficiency_factor;
        result.aerobicDecouplingPct = refreshed.aerobic_decoupling_pct;
        result.intervalsDetected = refreshed.interval_count;
      }
    }
    return results;
  })();
}

export function importDirectory(db: Database.Database, dirPath: string, options: ImportOptions = {}): ImportResult[] {
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath).filter(f => {
    const l = f.toLowerCase();
    return l.endsWith('.fit') || l.endsWith('.zip');
  });
  const results: ImportResult[] = [];
  for (const file of files) {
    results.push(importRunFile(db, path.join(dirPath, file), options));
  }
  return results;
}
