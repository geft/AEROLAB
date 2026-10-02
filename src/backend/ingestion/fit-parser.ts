import crypto from 'node:crypto';
import { Profile } from '@garmin/fitsdk';
import { isFitBuffer, isZipBuffer, parseFit, prepareFitExport, toCSV, type FitData, type FitExportOptions } from './fit-core.mjs';
import { repairSpeedTelemetry, type ActivityRecord, type ParsedCSV } from './csv-parser.js';

export { isFitBuffer, isZipBuffer, parseFit };
export interface ParsedFitResult {
  isRunning: boolean; sport: number | null; subSport: number | null;
  csv: string | null; dateStr: string; distanceM: number; durationS: number;
  avgHr: number | null; maxHr: number | null; avgCadence: number | null; recordCount: number;
}
export function detectFileFormat(buffer: Buffer, filename?: string): 'fit' | 'csv' | 'zip' {
  if (isZipBuffer(buffer) || filename?.toLowerCase().endsWith('.zip')) return 'zip';
  return isFitBuffer(buffer) || filename?.toLowerCase().endsWith('.fit') ? 'fit' : 'csv';
}

function runOptions(parsed: FitData, filename: string, id?: string, name?: string): FitExportOptions | null {
  const running = parsed.sessions.filter(session => session.sport === 'running');
  if (!running.length) return null;
  if (running.length > 1) throw new Error('FIT contains multiple running sessions; export each running session separately');
  const file = parsed.messages.file_id?.[0];
  const fallbackId = file?.serial_number != null && file.time_created ? undefined :
    `fit_${filename.replace(/\.(fit|zip)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const options: FitExportOptions = { session: running[0], id: id ?? fallbackId, name };
  const match = filename.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  if (match && !parsed.messages.activity?.[0]?.local_timestamp) {
    const local = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
    const offset = (local - Date.parse(running[0].start_time)) / 1000;
    if (Math.abs(offset) <= 14 * 3600) options.utcOffsetSeconds = offset;
  }
  return options;
}
const nullable = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Native FIT ingestion: no CSV serialization or reparsing on this path. */
export function parseRunFit(buffer: Buffer, filename: string, existingActivityId?: string, existingName?: string): ParsedCSV | null {
  const parsed = parseFit(buffer);
  const options = runOptions(parsed, filename, existingActivityId, existingName);
  if (!options) return null;
  const output = prepareFitExport(parsed, {}, options);
  const session = output.session;
  const start = Date.parse(output.records[0]?.timestamp ?? output.date);
  const records: ActivityRecord[] = output.records.map(record => ({
    timestamp: record.timestamp, elapsedSeconds: Math.max(0, (Date.parse(record.timestamp) - start) / 1000),
    heartRate: nullable(record.heart_rate), cadence: nullable(record.cadence),
    speedMps: nullable(record.speed), distanceMeters: nullable(record.distance), altitudeMeters: nullable(record.altitude),
    latitude: nullable(record.position_lat), longitude: nullable(record.position_long), temperature: nullable(record.temperature),
    verticalOscillation: nullable(record.vertical_oscillation), stanceTime: nullable(record.stance_time),
    stepLength: nullable(record.step_length), fractionalCadence: nullable(record.fractional_cadence), power: nullable(record.power),
    verticalRatio: nullable(record.vertical_ratio), stanceTimeBalance: nullable(record.stance_time_balance),
    respirationRate: nullable(record.respiration_rate), coreTemperature: nullable(record.core_temperature), fitFields: record,
  }));
  repairSpeedTelemetry(records);
  return {
    fileHash: crypto.createHash('sha256').update(parsed.sourceFit).digest('hex'),
    metadata: {
      id: output.id, name: output.name, date: output.date, sport: output.sport,
      totalDistanceMeters: session.total_distance ?? 0,
      totalDurationSeconds: session.total_timer_time ?? session.total_elapsed_time ?? 0,
      totalElapsedSeconds: session.total_elapsed_time ?? session.total_timer_time ?? 0,
      avgHeartRate: session.avg_heart_rate ?? 0, maxHeartRate: session.max_heart_rate ?? 0,
      avgCadence: output.metadataFields['Avg Cadence (spm)'] ?? 0, maxCadence: output.metadataFields['Max Cadence (spm)'] ?? 0,
      calories: session.total_calories ?? 0, totalAscentMeters: session.total_ascent ?? 0, totalDescentMeters: session.total_descent ?? 0,
    },
    records, fitMetadata: output.metadata, sourceFit: Buffer.from(parsed.sourceFit),
  };
}

/** Compatibility API for scripts that explicitly request a CSV export. */
export function convertFitToCsv(buffer: Buffer, filename: string, existingActivityId?: string, existingName?: string): ParsedFitResult {
  const parsed = parseFit(buffer);
  const options = runOptions(parsed, filename, existingActivityId, existingName);
  const session = options?.session ?? parsed.session;
  const enumNumber = (type: 'sport' | 'subSport', value: unknown) => {
    const entry = Object.entries(Profile.types[type]).find(([, name]) => name === value);
    return entry ? Number(entry[0]) : null;
  };
  const running = options !== null && parsed.records.length > 0;
  const output = running ? prepareFitExport(parsed, {}, options!) : null;
  return {
    isRunning: running, sport: enumNumber('sport', session?.sport), subSport: enumNumber('subSport', session?.sub_sport),
    csv: output ? toCSV(parsed, {}, options!) : null,
    dateStr: output?.date ?? '', distanceM: running ? session?.total_distance ?? 0 : 0,
    durationS: running ? session?.total_timer_time ?? session?.total_elapsed_time ?? 0 : 0,
    avgHr: nullable(session?.avg_heart_rate), maxHr: nullable(session?.max_heart_rate),
    avgCadence: nullable(output?.metadataFields['Avg Cadence (spm)']), recordCount: output?.records.length ?? parsed.records.length,
  };
}
