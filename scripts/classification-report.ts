/** Read-only fixed-profile evaluation; chronological replay only touches a backup. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { getDatabasePath } from '../src/backend/db/path.js';
import { ANALYSIS_RECORD_COLUMNS, analysisRecordFromRow } from '../src/backend/db/analysis-records.js';
import { decodeStoredJson } from '../src/backend/db/compression.js';
import { getHeartRateProfileAtDate, getStridePaceAnchorSecKmAtDate } from '../src/backend/physiology/threshold-tracker.js';
import { prepareAnalysisContext, analyzeWorkout } from '../src/backend/application/analysis/analyze-workout.js';
import { realignDatabase } from '../src/backend/db/realign.js';
import type { ActivityMetadata } from '../src/backend/domain/telemetry.js';
import type { RunType } from '../src/backend/ingestion/classifier.js';
import { observedDuration, timeWeightedMean } from '../src/backend/physiology/time-series.js';

const [destination = 'output/classification/baseline.json', comparison] = process.argv.slice(2);
const reportPath = path.resolve(destination);
const relativeOutput = path.relative(path.resolve('output/classification'), reportPath);
if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput) || !reportPath.endsWith('.json'))
  throw new Error('Reports must be JSON files inside ignored output/classification/');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
const source = new Database(getDatabasePath(), { readonly: true });
const copyPath = reportPath.replace(/\.json$/, '') + '.db';
if (fs.existsSync(copyPath)) throw new Error(`Copy already exists: ${copyPath}`);
await source.backup(copyPath);
source.close();
const db = new Database(copyPath);
const previous = comparison ? JSON.parse(fs.readFileSync(comparison, 'utf8')) as { rows: Array<{ id: string; profile: ReturnType<typeof getHeartRateProfileAtDate>; prediction: ReturnType<typeof analyzeWorkout>['classification'] }> } : undefined;
const previousRows = new Map(previous?.rows.map(row => [row.id, row]));
const activities = db.prepare('SELECT * FROM activities ORDER BY julianday(start_time), id').all() as Array<Record<string, string | number | null>>;
const reportRows = (fixedProfiles = true) => activities.map(act => {
  const id = String(act.id);
  const number = (key: string) => Number(act[key] ?? 0);
  const metadata: ActivityMetadata = {
    id, name: String(act.name ?? ''), sport: String(act.sport ?? 'running'), date: String(act.start_time),
    totalDistanceMeters: number('distance_meters'), totalDurationSeconds: number('duration_seconds'),
    totalElapsedSeconds: number('elapsed_seconds'), avgHeartRate: number('avg_heart_rate'), maxHeartRate: number('max_heart_rate'),
    avgCadence: number('avg_cadence'), maxCadence: number('max_cadence'), calories: number('calories'),
    totalAscentMeters: number('elevation_gain_m'), totalDescentMeters: number('elevation_loss_m')
  };
  const rawRecords = db.prepare(`SELECT ${ANALYSIS_RECORD_COLUMNS} FROM activity_records WHERE activity_id=? ORDER BY elapsed_seconds`).all(id).map(analysisRecordFromRow);
  const fit = db.prepare('SELECT metadata_json FROM activity_fit_details WHERE activity_id=?').get(id) as { metadata_json: string | Buffer } | undefined;
  const fitMetadata = fit ? JSON.parse(decodeStoredJson(fit.metadata_json)) : undefined;
  const profile = (fixedProfiles ? previousRows.get(id)?.profile : undefined) ?? getHeartRateProfileAtDate(db, metadata.date);
  const context = prepareAnalysisContext({ metadata, rawRecords, fitMetadata,
    historicalProfile: profile, stridePaceAnchorSecKm: getStridePaceAnchorSecKmAtDate(db, metadata.date) });
  const analysis = analyzeWorkout(context, { confirmedRunType: act.manual_run_type as RunType | null });
  const powerWindow = (from = -Infinity, to = Infinity) => ({
    seconds: observedDuration(context.records, r => r.elapsedSeconds, r => r.power != null && r.power > 0, from, to),
    mean: timeWeightedMean(context.records, r => r.elapsedSeconds, r => r.power, watts => watts > 0, from, to)
  });
  const devices = (Array.isArray(fitMetadata?.devices) ? fitMetadata.devices : []).map((device: Record<string, unknown>) =>
    Object.fromEntries(['manufacturer', 'product', 'product_name', 'device_type', 'software_version'].filter(key => device[key] != null).map(key => [key, device[key]])));
  return { id, date: metadata.date, storedAuto: act.auto_run_type, storedEffective: act.run_type, confirmed: act.manual_run_type,
    profile, prediction: analysis.classification, effective: analysis.runType, intervals: analysis.intervals,
    validatedLapCount: context.laps.length, timerAnnotated: context.hasTimerAnnotations,
    powerAudit: { devices, ...powerWindow(), windows: analysis.intervals.map(interval => ({ type: interval.type,
      ...powerWindow(interval.startSeconds, interval.startSeconds + interval.durationSeconds) })) },
    channelSeconds: Object.fromEntries(['heartRate', 'cadence', 'speedMps', 'power'].map(key => [key,
      observedDuration(context.records, record => record.elapsedSeconds, record => Number(record[key as keyof typeof record]) > 0)])),
    channelSamples: Object.fromEntries(['heartRate', 'cadence', 'speedMps', 'power'].map(key => [key,
      rawRecords.filter(record => Number(record[key as keyof typeof record]) > 0).length])) };
});
const rows = reportRows();
fs.writeFileSync(reportPath, JSON.stringify({ rows, transitions: rows.flatMap(row => {
  const before = previousRows.get(row.id)?.prediction;
  return before && before.runType !== row.prediction.runType ? [{ id: row.id, before, after: row.prediction }] : [];
}) }, null, 2) + '\n');
if (comparison) {
  const fingerprint = (tables: string[], omit: string[] = []) => {
    const hash = createHash('sha256');
    for (const table of tables) {
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(row => row.name).filter(name => !omit.includes(name));
      for (const row of db.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY ${columns.join(',')}`).iterate()) hash.update(JSON.stringify(row));
    }
    return hash.digest('hex');
  };
  const rawBefore = fingerprint(['activity_records', 'activity_fit_details']);
  const overridesBefore = JSON.stringify(db.prepare('SELECT id,manual_run_type,manual_failed_workout FROM activities ORDER BY id').all());
  const started = performance.now();
  const first = realignDatabase(db, { strict: true });
  const chronologicalRows = reportRows(false);
  const labels = db.prepare('SELECT id,auto_run_type,run_type,manual_run_type,manual_failed_workout FROM activities ORDER BY id').all();
  const analysesBefore = fingerprint(['activities', 'activity_intervals', 'activity_splits', 'activity_coach_summaries', 'physiological_thresholds'], ['id', 'created_at', 'updated_at']);
  const second = realignDatabase(db, { strict: true });
  const repeatable = JSON.stringify(labels) === JSON.stringify(db.prepare('SELECT id,auto_run_type,run_type,manual_run_type,manual_failed_workout FROM activities ORDER BY id').all());
  const dependentAnalysesRepeatable = analysesBefore === fingerprint(['activities', 'activity_intervals', 'activity_splits', 'activity_coach_summaries', 'physiological_thresholds'], ['id', 'created_at', 'updated_at']);
  const rawPreserved = rawBefore === fingerprint(['activity_records', 'activity_fit_details']);
  const overridesPreserved = overridesBefore === JSON.stringify(db.prepare('SELECT id,manual_run_type,manual_failed_workout FROM activities ORDER BY id').all());
  const sharedPipelineAgreement = chronologicalRows.every(row => (labels as Array<{ id: string; auto_run_type: string; run_type: string }>).some(label => label.id === row.id && label.auto_run_type === row.prediction.runType && label.run_type === row.effective));
  fs.writeFileSync(reportPath.replace(/\.json$/, '-chronological.json'), JSON.stringify({ first, second, repeatable, dependentAnalysesRepeatable, rawPreserved, overridesPreserved, sharedPipelineAgreement,
    runtimeMs: performance.now() - started, rows: chronologicalRows, transitions: chronologicalRows.filter(row => row.prediction.runType !== row.storedAuto), labels }, null, 2) + '\n');
  if (first.activitiesFailed.length || second.activitiesFailed.length || !repeatable || !dependentAnalysesRepeatable || !rawPreserved || !overridesPreserved || !sharedPipelineAgreement) process.exitCode = 1;
}
db.close();
console.log(`Reported ${rows.length} activities to ${reportPath}`);
