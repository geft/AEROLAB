import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDatabasePath } from '../src/backend/db/path.js';
import {
  getActivityDetailService, getBestEffortsService, getProgressHistoryService,
  getTrainingLoadService, getVolumeService, listActivitiesService
} from '../src/backend/services/activity-service.js';
import { getProfileService } from '../src/backend/services/profile-service.js';
import { getThresholdsService } from '../src/backend/services/thresholds-service.js';

export const SNAPSHOT_SCHEMA_VERSION = 1;
const outputPath = path.resolve('snapshot-data/snapshot.json');

// Deliberate wire allowlist. In particular, no activity GPS, detailed record
// coordinates, database paths, profile location, route names, or credentials.
const activityFields = new Set([
  'id', 'name', 'start_time', 'sport', 'run_type', 'auto_run_type', 'distance_meters',
  'duration_seconds', 'elapsed_seconds', 'avg_pace_sec_km', 'avg_heart_rate', 'max_heart_rate',
  'avg_cadence', 'max_cadence', 'calories', 'elevation_gain_m', 'elevation_loss_m',
  'avg_temperature', 'avg_vertical_oscillation', 'avg_stance_time', 'efficiency_factor',
  'aerobic_decoupling_pct', 'meters_per_beat', 'estimated_lt1_hr', 'estimated_lt1_pace_sec_km',
  'estimated_lt2_hr', 'estimated_lt2_pace_sec_km', 'steady_pace_sec_km', 'steady_heart_rate',
  'steady_cadence', 'steady_stance_time', 'pause_duration_seconds', 'walk_duration_seconds',
  'walk_distance_meters', 'weather_temperature_c', 'weather_humidity_pct', 'weather_apparent_temp_c',
  'weather_pm25_ug_m3', 'weather_condition', 'weather_code', 'weather_fetched_at', 'weather_source', 'tags', 'training_load',
  'z1_seconds', 'z2_seconds', 'z3_seconds', 'z4_seconds', 'z5_seconds', 'effectiveness_score', 'verdict'
]);
const recordFields = new Set([
  'id', 'activity_id', 'elapsed_seconds', 'distance_m', 'speed_mps', 'heart_rate', 'cadence',
  'altitude_m', 'temp', 'vert_osc', 'stance_time', 'step_length', 'vertical_ratio'
]);
const profileFields = new Set([
  'id', 'age', 'resting_hr', 'max_hr', 'is_max_hr_estimated', 'is_configured'
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
      details[String(activity.id)] = {
        ...(scrub(detail) as Record<string, unknown>),
        activity: pickObject(detail.activity, activityFields),
        records: detail.records.map(record => pickObject(record, recordFields))
      };
    }
    const profileResponse = getProfileService(db);
    if (!profileResponse) throw new Error('The active database has no athlete profile.');
    const profile = { ...profileResponse, profile: pickObject(profileResponse.profile, profileFields) };
    const runTypes = ['all', 'easy', 'threshold', ...new Set(activities.map(activity => String(activity.run_type || 'Other')))];
    const progressByRunType = Object.fromEntries(runTypes.map(type => [type, scrub(getProgressHistoryService(db, type))]));
    const thresholdsByRunType = Object.fromEntries(runTypes.map(type => [type, scrub(getThresholdsService(db, type === 'all' ? undefined : type))]));
    const months = [...new Set(activities.map(activity => String(activity.start_time).slice(0, 7)))];
    const years = [...new Set(activities.map(activity => String(activity.start_time).slice(0, 4)))];
    const volume: Record<string, unknown> = {};
    for (const month of months) volume[`month:${month}`] = scrub(getVolumeService(db, { period: 'month', month }));
    for (const year of years) volume[`year:${year}`] = scrub(getVolumeService(db, { period: 'year', year }));
    for (const period of ['week', 'month', 'year']) volume[`${period}:current`] = scrub(getVolumeService(db, { period }));
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
    fs.writeFileSync(temporaryPath, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
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
  if (!value || typeof value !== 'object') throw new Error('Snapshot must be a JSON object.');
  const data = value as Record<string, any>;
  if (data.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) throw new Error(`Unsupported snapshot schema version: ${data.schemaVersion}`);
  if (typeof data.generatedAt !== 'string' || Number.isNaN(Date.parse(data.generatedAt))) throw new Error('Snapshot generatedAt must be a valid ISO timestamp.');
  for (const section of ['activities', 'details', 'profile', 'bestEfforts', 'progressByRunType', 'thresholdsByRunType', 'volume', 'trainingLoadByDays']) {
    if (!data[section] || typeof data[section] !== 'object') throw new Error(`Snapshot is missing required section: ${section}`);
  }
  if (!Array.isArray(data.activities) || Array.isArray(data.details) || Array.isArray(data.profile)) {
    throw new Error('Snapshot activity, detail, or profile sections have invalid shapes.');
  }
  const ids = new Set<string>();
  for (const activity of data.activities) {
    if (typeof activity.id !== 'string' || !activity.id || ids.has(activity.id)) throw new Error('Snapshot activity IDs must be unique non-empty strings.');
    if (typeof activity.start_time !== 'string' || Number.isNaN(Date.parse(activity.start_time))) throw new Error(`Snapshot activity ${activity.id} has an invalid start_time.`);
    ids.add(activity.id);
  }
  for (const id of ids) if (!data.details[id]) throw new Error(`Snapshot is missing detail data for activity ${id}.`);
  const encoded = JSON.stringify(data);
  if (/"(?:workout_lat|workout_lon|latitude|longitude|databasePath|sessionToken|access_token|refresh_token)"/i.test(encoded)) {
    throw new Error('Snapshot contains a forbidden coordinate or credential field.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
