import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { parseRunCSV, ParsedCSV } from './csv-parser';
import { convertFitToCsv, isFitBuffer } from './fit-parser.js';
import { calculateEconomy, calculateKmSplits } from '../physiology/economy.js';
import { detectIntervals } from './interval-detector.js';
import { classifyRun } from './classifier.js';
import { evaluateThresholdUpdate } from '../physiology/threshold-tracker.js';
import { downsampleRecords } from './downsampler.js';
import { syncActivityCoachSummary } from '../physiology/coach-summary.js';
import { syncActivityWeather } from '../physiology/weather.js';

export interface ImportResult {
  status: 'imported' | 'skipped_duplicate' | 'error';
  activityId?: string;
  name?: string;
  date?: string;
  runType?: string;
  distanceKm?: number;
  durationMin?: number;
  efficiencyFactor?: number | null;
  aerobicDecouplingPct?: number | null;
  intervalsDetected?: number;
  error?: string;
}

export interface ImportOptions {
  force?: boolean;
}

export function importRunFile(db: Database.Database, filePath: string, options: ImportOptions = {}): ImportResult {
  try {
    if (!fs.existsSync(filePath)) {
      return { status: 'error', error: `File not found: ${filePath}` };
    }

    const filename = path.basename(filePath);
    const buffer = fs.readFileSync(filePath);

    // Auto-detect algorithm: Garmin FIT binary vs standard CSV
    if (isFitBuffer(buffer) || filename.toLowerCase().endsWith('.fit')) {
      const fitResult = convertFitToCsv(buffer, filename);
      if (!fitResult.csv) {
        return { status: 'error', error: 'FIT file does not contain a supported running session' };
      }
      return importRunContent(db, fitResult.csv, filename, options);
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
    const parsed = parseRunCSV(content, filename);
    const { fileHash, metadata, records } = parsed;

    if (!records || records.length === 0) {
      return { status: 'error', error: 'CSV file contains no valid records' };
    }

  // 1. Check for duplicate via hash OR matching activity ID
  const existing = db.prepare('SELECT id, source_file_hash FROM activities WHERE source_file_hash = ? OR id = ?').get(fileHash, metadata.id) as { id: string; source_file_hash: string } | undefined;
  if (existing && !options.force) {
    return {
      status: 'skipped_duplicate',
      activityId: existing.id,
      name: metadata.name,
      date: metadata.date
    };
  }

  // If force re-importing, purge old rows for this activity first
  if (existing && options.force) {
    const targetId = existing.id;
    db.prepare('DELETE FROM activity_splits WHERE activity_id = ?').run(targetId);
    db.prepare('DELETE FROM activity_intervals WHERE activity_id = ?').run(targetId);
    db.prepare('DELETE FROM activity_records WHERE activity_id = ?').run(targetId);
    db.prepare('DELETE FROM physiological_thresholds WHERE source_activity_id = ?').run(targetId);
    db.prepare('DELETE FROM activity_coach_summaries WHERE activity_id = ?').run(targetId);
    db.prepare('DELETE FROM activities WHERE id = ?').run(targetId);
  }


  // 2. Compute Physiology & Intervals
  const economy = calculateEconomy(records);
  const splits = calculateKmSplits(records, 1000);
  const intervals = detectIntervals(records);
  const classification = classifyRun(metadata, records, economy, intervals);

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
      id, source_filename, source_file_hash, start_time, name, sport,
      run_type, auto_run_type, distance_meters, duration_seconds, elapsed_seconds,
      avg_pace_sec_km, avg_heart_rate, max_heart_rate, avg_cadence, max_cadence,
      calories, elevation_gain_m, elevation_loss_m, avg_temperature,
      avg_vertical_oscillation, avg_stance_time, efficiency_factor,
      aerobic_decoupling_pct, meters_per_beat, workout_lat, workout_lon,
      steady_pace_sec_km, steady_heart_rate, steady_cadence, steady_stance_time,
      pause_duration_seconds, walk_duration_seconds, walk_distance_meters,
      tags
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?
    )
  `);

  const insertSplit = db.prepare(`
    INSERT INTO activity_splits (
      activity_id, split_index, distance_meters, duration_seconds,
      avg_pace_sec_km, avg_heart_rate, split_efficiency_factor, elevation_change_m
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertInterval = db.prepare(`
    INSERT INTO activity_intervals (
      activity_id, interval_index, type, start_seconds, duration_seconds,
      distance_meters, avg_speed_mps, avg_pace_sec_km, avg_heart_rate,
      max_heart_rate, avg_cadence, peak_cadence, peak_speed_mps, peak_pace_sec_km,
      min_stance_time, hr_drop
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRecord = db.prepare(`
    INSERT INTO activity_records (
      activity_id, timestamp, elapsed_seconds, heart_rate, cadence,
      speed_mps, distance_m, altitude_m, lat, lon, temp, vert_osc, stance_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  const initialTags: string[] = [];
  if (classification.runType === 'easy_base') initialTags.push('Easy Base');
  else if (classification.runType === 'threshold_lt2') initialTags.push('Threshold');
  else if (classification.runType === 'intervals_vo2') initialTags.push('VO2 Max');
  else if (classification.runType === 'long_run') initialTags.push('Long Run');
  else if (classification.runType === 'recovery') initialTags.push('Recovery');
  else if (classification.runType === 'race') initialTags.push('Race');

  const nameLower = (metadata.name || '').toLowerCase();

  // Marathon Pace check: long run containing sustained Zone 3 blocks
  const hasMpBlocks =
    classification.runType === 'long_run' &&
    (intervals.some(i => i.type === 'work' && i.durationSeconds >= 600 && i.avgHeartRate >= 148 && i.avgHeartRate <= 165) ||
      nameLower.includes('marathon pace') || nameLower.includes('mp'));
  if (hasMpBlocks && !initialTags.includes('Marathon Pace')) {
    initialTags.push('Marathon Pace');
  }

  // Tempo check
  if (nameLower.includes('tempo') && !initialTags.includes('Tempo')) {
    initialTags.push('Tempo');
  }

  // Strides: short burst or explicit name
  const hasStrides = intervals.some(i => i.type === 'stride') || nameLower.includes('stride');
  if (hasStrides && !initialTags.includes('Strides')) {
    initialTags.push('Strides');
  }

  const pb = economy.pauseBreakdown;

  const transaction = db.transaction(() => {
    insertActivity.run(
      metadata.id,
      filename,
      fileHash,
      metadata.date,
      metadata.name,
      metadata.sport,
      classification.runType,
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
      JSON.stringify(initialTags)
    );


    // Splits
    for (const s of splits) {
      insertSplit.run(
        metadata.id,
        s.splitIndex,
        s.distanceMeters,
        s.durationSeconds,
        s.avgPaceSecKm,
        s.avgHeartRate,
        s.splitEfficiencyFactor,
        s.elevationChangeM
      );
    }

    // Intervals
    for (const inv of intervals) {
      insertInterval.run(
        metadata.id,
        inv.intervalIndex,
        inv.type,
        inv.startSeconds,
        inv.durationSeconds,
        inv.distanceMeters,
        inv.avgSpeedMps,
        inv.avgPaceSecKm,
        inv.avgHeartRate,
        inv.maxHeartRate,
        inv.avgCadence,
        inv.peakCadence ?? null,
        inv.peakSpeedMps ?? null,
        inv.peakPaceSecKm ?? null,
        inv.minStanceTime ?? null,
        inv.hrDrop ?? null
      );
    }

    // Time-series records: apply smart downsampling to drastically compact storage
    const compactedRecords = downsampleRecords(records, intervals);
    for (const r of compactedRecords) {
      insertRecord.run(
        metadata.id,
        r.timestamp,
        r.elapsedSeconds,
        r.heartRate,
        r.cadence,
        r.speedMps,
        r.distanceMeters,
        r.altitudeMeters,
        r.latitude,
        r.longitude,
        r.temperature,
        r.verticalOscillation,
        r.stanceTime
      );
    }

    // Threshold updates
    evaluateThresholdUpdate(db, metadata.id, metadata.date, classification.runType, metadata, records, economy);
  });

  transaction();

  // Continuously populate and persist the AI coach summary into activity_coach_summaries
  syncActivityCoachSummary(db, metadata.id);

  // Automatically fetch microclimate historical weather in the background
  syncActivityWeather(db, metadata.id).catch(() => {});

    return {
      status: 'imported',
      activityId: metadata.id,
      name: metadata.name,
      date: metadata.date,
      runType: classification.runType,
      distanceKm: Number((metadata.totalDistanceMeters / 1000).toFixed(2)),
      durationMin: Number((metadata.totalDurationSeconds / 60).toFixed(1)),
      efficiencyFactor: economy.efficiencyFactor,
      aerobicDecouplingPct: economy.aerobicDecouplingPct,
      intervalsDetected: intervals.length
    };
  } catch (err: any) {
    return { status: 'error', error: err.message || 'Failed to parse and import run' };
  }
}

export function importDirectory(db: Database.Database, dirPath: string, options: ImportOptions = {}): ImportResult[] {
  if (!fs.existsSync(dirPath)) return [];
  const files = fs.readdirSync(dirPath).filter(f => {
    const l = f.toLowerCase();
    return l.endsWith('.csv') || l.endsWith('.fit');
  });
  const results: ImportResult[] = [];
  for (const file of files) {
    results.push(importRunFile(db, path.join(dirPath, file), options));
  }
  return results;
}
