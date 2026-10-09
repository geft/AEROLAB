import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { getDatabasePath } from '../src/backend/db/path.js';
import {
  getActivityDetailService, getBestEffortsService, getProgressHistoryService,
  getTrainingLoadService, getVolumeService, listActivitiesService
} from '../src/backend/services/activity-service.js';
import { getProfileService } from '../src/backend/services/profile-service.js';
import { getThresholdsService } from '../src/backend/services/thresholds-service.js';
import { sampleSnapshotTelemetry } from './snapshot-telemetry.js';
import { encodeSnapshot, SNAPSHOT_FILENAME, SNAPSHOT_SCHEMA_VERSION, validateSnapshotDocument } from '../src/shared/snapshot-codec.js';

export { SNAPSHOT_SCHEMA_VERSION } from '../src/shared/snapshot-codec.js';
const outputPath = path.resolve('snapshot-data', SNAPSHOT_FILENAME);

// Deliberate wire allowlist. In particular, no activity GPS, detailed record
// coordinates, database paths, profile location, route names, or credentials.
const activityFields = new Set([
  'id', 'name', 'start_time', 'sport', 'is_treadmill', 'run_type', 'auto_run_type', 'distance_meters',
  'duration_seconds', 'elapsed_seconds', 'avg_pace_sec_km', 'avg_heart_rate', 'max_heart_rate',
  'avg_cadence', 'max_cadence', 'calories', 'elevation_gain_m', 'elevation_loss_m',
  'avg_temperature', 'avg_vertical_oscillation', 'avg_stance_time', 'efficiency_factor',
  'aerobic_decoupling_pct', 'meters_per_beat', 'estimated_lt1_hr', 'estimated_lt1_pace_sec_km',
  'estimated_lt2_hr', 'estimated_lt2_pace_sec_km', 'steady_pace_sec_km', 'steady_heart_rate',
  'steady_cadence', 'steady_stance_time', 'pause_duration_seconds', 'walk_duration_seconds',
  'walk_distance_meters', 'weather_temperature_c', 'weather_humidity_pct', 'weather_apparent_temp_c',
  'weather_pm25_ug_m3', 'weather_pm25_source', 'weather_condition', 'weather_code', 'weather_fetched_at', 'weather_source', 'tags', 'training_load',
  'z1_seconds', 'z2_seconds', 'z3_seconds', 'z4_seconds', 'z5_seconds', 'effectiveness_score', 'verdict'
]);
const recordFields = new Set([
  'elapsed_seconds', 'distance_m', 'speed_mps', 'heart_rate', 'altitude_m'
]);
const profileFields = new Set([
  'id', 'age', 'gender', 'resting_hr', 'max_hr', 'is_max_hr_estimated', 'is_configured'
]);

function pickObject(value: unknown, fields: Set<string>): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => fields.has(key)));
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const hidden = /(^|_)(lat|lon|latitude|longitude|gps|notes|location|favorite_route|database_path|token|secret|password|credential)(_|$)/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !hidden.test(key))
    .map(([key, child]) => [key, scrub(child)]));
}

export function exportSnapshot(dbPath = getDatabasePath(), destination = outputPath): void {
  if (!fs.existsSync(dbPath)) throw new Error(`Database does not exist: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 5000 });
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  try {
    db.pragma('query_only = ON');
    db.exec('BEGIN');
    const activities = listActivitiesService(db).activities.map(activity => pickObject(activity, activityFields));
    const details: Record<string, unknown> = {};
    for (const activity of activities) {
      const detail = getActivityDetailService(db, String(activity.id), { persistCoachSummary: false });
      if (!detail) throw new Error(`Activity disappeared during snapshot export: ${activity.id}`);
      // Original FIT metadata is only used for desktop CSV export.
      const { fitMetadata: _fitMetadata, ...readOnlyDetail } = detail;
      details[String(activity.id)] = {
        ...(scrub(readOnlyDetail) as Record<string, unknown>),
        activity: pickObject(detail.activity, activityFields),
        records: sampleSnapshotTelemetry(detail.records, detail.intervals).map(record => pickObject(record, recordFields))
      };
    }
    const profileResponse = getProfileService(db);
    if (!profileResponse) throw new Error('The active database has no athlete profile.');
    const profile = {
      ...profileResponse,
      profile: {
        ...pickObject(profileResponse.profile, profileFields),
        age: profileResponse.profile.age ?? null,
        gender: profileResponse.profile.gender ?? null
      }
    };
    const runTypes = ['all', 'easy', 'threshold', ...new Set(activities.map(activity => String(activity.run_type || 'Other')))];
    const progressByRunType = Object.fromEntries(runTypes.map(type => [type, scrub(getProgressHistoryService(db, type))]));
    const thresholdsByRunType = Object.fromEntries(runTypes.map(type => [type, scrub(getThresholdsService(db, type === 'all' ? undefined : type))]));
    const months = [...new Set(activities.map(activity => String(activity.start_time).slice(0, 7)))];
    const years = [...new Set(activities.map(activity => String(activity.start_time).slice(0, 4)))];
    const volume: Record<string, unknown> = {};
    for (const month of months) volume[`month:${month}`] = scrub(getVolumeService(db, { period: 'month', month }));
    for (const year of years) volume[`year:${year}`] = scrub(getVolumeService(db, { period: 'year', year }));
    for (const period of ['week', 'month', 'year', 'all']) volume[`${period}:current`] = scrub(getVolumeService(db, { period }));
    const trainingLoadByDays = Object.fromEntries([7, 14, 30, 60, 90, 180].map(days => [days, scrub(getTrainingLoadService(db, days))]));
    const snapshot = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      activities,
      details,
      profile,
      bestEfforts: scrub(getBestEffortsService(db)),
      progressByRunType,
      thresholdsByRunType,
      volume,
      trainingLoadByDays
    };
    validateSnapshot(snapshot);
    db.exec('COMMIT');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(temporaryPath, gzipSync(encodeSnapshot(snapshot), { level: 9 }), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporaryPath, destination);
    console.log(`Snapshot exported: ${destination} (${activities.length} activities, ${snapshot.generatedAt})`);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  } finally {
    db.close();
  }
}

export function validateSnapshot(value: unknown): asserts value is Record<string, any> {
  validateSnapshotDocument(value);
  const encoded = JSON.stringify(value);
  if (/"(?:workout_lat|workout_lon|latitude|longitude|databasePath|sessionToken|access_token|refresh_token)"/i.test(encoded)) {
    throw new Error('Snapshot contains a forbidden coordinate or credential field.');
  }
}

const isBundledCli = process.env.AEROLAB_EXPORT_SNAPSHOT_CLI === '1';
const sourceUrl = typeof import.meta !== 'undefined' ? import.meta.url : undefined;
if (isBundledCli || (sourceUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(sourceUrl))) {
  try {
    const args = process.argv.slice(2);
    let databasePath: string | undefined = process.env.AEROLAB_SNAPSHOT_DATABASE_PATH
      ? path.resolve(process.env.AEROLAB_SNAPSHOT_DATABASE_PATH)
      : undefined;
    let destination = outputPath;
    for (let index = 0; index < args.length; index++) {
      const flag = args[index];
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Expected a value after ${flag}.`);
      if (flag === '--database') databasePath = path.resolve(value);
      else if (flag === '--output') destination = path.resolve(value);
      else throw new Error(`Unknown argument: ${flag}. Supported options: --database, --output.`);
      index++;
    }
    exportSnapshot(databasePath ?? getDatabasePath(), destination);
  } catch (error) {
    console.error(`Snapshot export failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
