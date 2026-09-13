/**
 * Robust FIT binary protocol parser for run-progress.
 * Parses Garmin .fit files into session metadata and time-series records,
 * and converts running activities into standard AI-friendly CSV format.
 */

export interface ParsedFitResult {
  isRunning: boolean;
  sport: number | null;
  subSport: number | null;
  csv: string | null;
  dateStr: string;
  distanceM: number;
  durationS: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  recordCount: number;
}

const GARMIN_EPOCH = Date.UTC(1989, 11, 31, 0, 0, 0) / 1000;

const FIELD_SCALES: Record<string, { scale: number; offset?: number }> = {
  altitude: { scale: 5, offset: 500 },
  enhanced_altitude: { scale: 5, offset: 500 },
  distance: { scale: 100 },
  total_distance: { scale: 100 },
  speed: { scale: 1000 },
  enhanced_speed: { scale: 1000 },
  avg_speed: { scale: 1000 },
  max_speed: { scale: 1000 },
  vertical_oscillation: { scale: 10 },
  avg_vertical_oscillation: { scale: 10 },
  stance_time: { scale: 10 },
  avg_stance_time: { scale: 10 },
  stance_time_percent: { scale: 100 },
  avg_stance_time_percent: { scale: 100 },
  vertical_ratio: { scale: 100 },
  stance_time_balance: { scale: 100 },
  step_length: { scale: 10 },
  avg_step_length: { scale: 10 },
  total_elapsed_time: { scale: 1000 },
  total_timer_time: { scale: 1000 },
  core_temperature: { scale: 100 },
};

const RECORD_FIELDS: Record<number, string> = {
  253: 'timestamp',
  0: 'position_lat',
  1: 'position_long',
  2: 'altitude',
  3: 'heart_rate',
  4: 'cadence',
  5: 'distance',
  6: 'speed',
  7: 'power',
  13: 'temperature',
  39: 'vertical_oscillation',
  40: 'stance_time_percent',
  41: 'stance_time',
  78: 'enhanced_speed',
  73: 'enhanced_altitude',
  87: 'vertical_ratio',
  88: 'stance_time_balance',
  89: 'step_length',
  114: 'core_temperature',
};

const SESSION_FIELDS: Record<number, string> = {
  253: 'timestamp',
  2: 'start_time',
  7: 'total_elapsed_time',
  8: 'total_timer_time',
  9: 'total_distance',
  11: 'total_calories',
  14: 'avg_speed',
  15: 'max_speed',
  16: 'avg_heart_rate',
  17: 'max_heart_rate',
  18: 'avg_cadence',
  19: 'max_cadence',
  20: 'avg_power',
  21: 'max_power',
  22: 'total_ascent',
  23: 'total_descent',
  5: 'sport',
  6: 'sub_sport',
  25: 'first_lap_index',
  26: 'num_laps',
  44: 'avg_vertical_oscillation',
  45: 'avg_stance_time_percent',
  46: 'avg_stance_time',
  168: 'avg_step_length',
};

interface FieldDef {
  fieldDefNum: number;
  size: number;
  baseType: number;
}

interface MesgDef {
  globalMesgNum: number;
  fields: FieldDef[];
  totalSize: number;
  arch: number;
}

function readField(view: DataView, offset: number, baseType: number, size: number, arch: number): any {
  const isLe = arch === 0;
  const typeKey = baseType & 0x1f;
  try {
    switch (typeKey) {
      case 0x00:
      case 0x02:
      case 0x0a:
      case 0x0d:
        return view.getUint8(offset);
      case 0x01:
        return view.getInt8(offset);
      case 0x03:
        return view.getInt16(offset, isLe);
      case 0x04:
      case 0x0b:
        return view.getUint16(offset, isLe);
      case 0x05:
        return view.getInt32(offset, isLe);
      case 0x06:
      case 0x0c:
        return view.getUint32(offset, isLe);
      case 0x07: {
        const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, size);
        const nullIdx = bytes.indexOf(0);
        return new TextDecoder().decode(bytes.slice(0, nullIdx >= 0 ? nullIdx : size));
      }
      case 0x08:
        return view.getFloat32(offset, isLe);
      case 0x09:
        return view.getFloat64(offset, isLe);
      default:
        return view.getUint8(offset);
    }
  } catch {
    return null;
  }
}

function isInvalid(val: any, baseType: number): boolean {
  const typeKey = baseType & 0x1f;
  if (typeKey === 0x00 || typeKey === 0x02 || typeKey === 0x0d) return val === 0xff;
  if (typeKey === 0x01) return val === 0x7f;
  if (typeKey === 0x03) return val === 0x7fff || val === -32768;
  if (typeKey === 0x04) return val === 0xffff;
  if (typeKey === 0x05) return val === 0x7fffffff || val === -2147483648;
  if (typeKey === 0x06 || typeKey === 0x0c) return val === 0xffffffff;
  if (typeKey === 0x0a || typeKey === 0x0b) return val === 0;
  return false;
}

function applyScale(fieldName: string, rawVal: number): number {
  const s = FIELD_SCALES[fieldName];
  if (!s) return rawVal;
  let val = rawVal / s.scale;
  if (s.offset) val -= s.offset;
  return Math.round(val * 10000) / 10000;
}

function convertSemicircles(semi: number): number {
  return Math.round((semi * (180 / Math.pow(2, 31))) * 1000000) / 1000000;
}

/**
 * Parse a raw binary FIT buffer and convert running workouts to standard CSV.
 */
export function convertFitToCsv(
  buffer: Buffer,
  filename: string,
  existingActivityId?: string,
  existingName?: string
): ParsedFitResult {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const headerSize = data[0];
  const dataSize = view.getUint32(4, true);
  const dataSig = String.fromCharCode(data[8], data[9], data[10], data[11]);
  if (dataSig !== '.FIT') {
    throw new Error('Not a valid FIT file (signature mismatch)');
  }

  const definitions: Record<number, MesgDef> = {};
  const records: any[] = [];
  let session: any = null;
  let activityMsg: any = null;
  let fileIdMsg: any = null;

  let offset = headerSize;
  const end = headerSize + dataSize;
  let lastTimestamp = 0;

  while (offset < end) {
    const recordHeader = data[offset++];

    // Compressed timestamp header (bit 7 set)
    if (recordHeader & 0x80) {
      const localMesgType = (recordHeader >> 5) & 0x3;
      const tsOffset = recordHeader & 0x1f;

      lastTimestamp = (lastTimestamp & 0xffffffe0) + tsOffset;
      if (tsOffset < (lastTimestamp & 0x1f)) {
        lastTimestamp += 0x20;
      }

      const def = definitions[localMesgType];
      if (!def) continue;

      const msg = readData(offset, def, lastTimestamp);
      offset += def.totalSize;

      if (def.globalMesgNum === 20) records.push(msg);
      else if (def.globalMesgNum === 18) session = msg;
      continue;
    }

    const isDefinition = (recordHeader & 0x40) !== 0;
    const localMesgType = recordHeader & 0x0f;

    if (isDefinition) {
      offset++; // reserved
      const arch = data[offset++];
      const isLe = arch === 0;
      const globalMesgNum = view.getUint16(offset, isLe);
      offset += 2;
      const numFields = data[offset++];
      const fields: FieldDef[] = [];
      let totalSize = 0;

      for (let i = 0; i < numFields; i++) {
        const fieldDefNum = data[offset++];
        const size = data[offset++];
        const baseType = data[offset++];
        fields.push({ fieldDefNum, size, baseType });
        totalSize += size;
      }

      if (recordHeader & 0x20) {
        const numDevFields = data[offset++];
        for (let i = 0; i < numDevFields; i++) {
          offset += 3;
        }
      }

      definitions[localMesgType] = { globalMesgNum, fields, totalSize, arch };
    } else {
      const def = definitions[localMesgType];
      if (!def) continue;

      const msg = readData(offset, def, null);
      offset += def.totalSize;

      if (msg.rawTimestamp) {
        lastTimestamp = msg.rawTimestamp;
      }

      if (def.globalMesgNum === 20) {
        records.push(msg);
      } else if (def.globalMesgNum === 18) {
        session = msg;
      } else if (def.globalMesgNum === 34) {
        activityMsg = msg;
      } else if (def.globalMesgNum === 0) {
        fileIdMsg = msg;
      }
    }
  }

  function readData(dataOffset: number, def: MesgDef, compressedTs: number | null) {
    const fieldMap = def.globalMesgNum === 20 ? RECORD_FIELDS : def.globalMesgNum === 18 ? SESSION_FIELDS : null;
    const msg: any = {};
    let fOffset = dataOffset;

    for (const f of def.fields) {
      const raw = readField(view, fOffset, f.baseType, f.size, def.arch);
      if (raw !== null && !isInvalid(raw, f.baseType)) {
        if (f.fieldDefNum === 253) {
          msg.rawTimestamp = raw;
        }
        if (def.globalMesgNum === 34 && f.fieldDefNum === 5) {
          msg.localTimestamp = raw;
        }
        if (def.globalMesgNum === 0 && f.fieldDefNum === 3) {
          msg.serialNumber = raw;
        }
        if (def.globalMesgNum === 0 && f.fieldDefNum === 4) {
          msg.timeCreated = raw;
        }

        if (fieldMap && fieldMap[f.fieldDefNum]) {
          const fn = fieldMap[f.fieldDefNum];
          if (fn === 'position_lat' || fn === 'position_long') {
            msg[fn] = convertSemicircles(raw);
          } else if (fn === 'timestamp' || fn === 'start_time') {
            msg[fn] = raw;
          } else {
            msg[fn] = applyScale(fn, raw);
          }
        }
      }
      fOffset += f.size;
    }

    if (compressedTs !== null && !msg.rawTimestamp) {
      msg.rawTimestamp = compressedTs;
      msg.timestamp = compressedTs;
    }

    return msg;
  }

  const isRunning = session?.sport === 1;
  const distanceM = session?.total_distance || 0;
  const durationS = session?.total_timer_time || session?.total_elapsed_time || 0;

  if (!isRunning || records.length === 0) {
    return {
      isRunning: false,
      sport: session?.sport ?? null,
      subSport: session?.sub_sport ?? null,
      csv: null,
      dateStr: '',
      distanceM: 0,
      durationS: 0,
      avgHr: session?.avg_heart_rate ?? null,
      maxHr: session?.max_heart_rate ?? null,
      avgCadence: session?.avg_cadence ? session.avg_cadence * 2 : null,
      recordCount: records.length,
    };
  }

  // Calculate local time offset:
  // Activity message local_timestamp gives local time; if absent, infer from filename or default SGT (+8h)
  let tzOffsetSec = 8 * 3600;
  if (activityMsg && activityMsg.rawTimestamp && activityMsg.localTimestamp) {
    tzOffsetSec = activityMsg.localTimestamp - activityMsg.rawTimestamp;
  } else {
    const fnMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
    if (fnMatch && session?.start_time) {
      const fnDateLocal = new Date(
        Date.UTC(+fnMatch[1], +fnMatch[2] - 1, +fnMatch[3], +fnMatch[4], +fnMatch[5], +fnMatch[6])
      );
      const utcMs = (session.start_time + GARMIN_EPOCH) * 1000;
      tzOffsetSec = Math.round((fnDateLocal.getTime() - utcMs) / 1000);
    }
  }

  function formatLocalDate(garminSec: number): string {
    const d = new Date((garminSec + GARMIN_EPOCH + tzOffsetSec) * 1000);
    return d.toISOString().replace('T', ' ').replace('.000Z', '');
  }

  function formatLocalISO(garminSec: number): string {
    const d = new Date((garminSec + GARMIN_EPOCH + tzOffsetSec) * 1000);
    return d.toISOString().replace('Z', '');
  }

  const startDateLocal = session?.start_time
    ? formatLocalDate(session.start_time)
    : formatLocalDate(records[0].timestamp);

  // Deterministic Activity ID
  const actId =
    existingActivityId ||
    (fileIdMsg?.serialNumber && fileIdMsg?.timeCreated
      ? `garmin_${fileIdMsg.serialNumber}_${fileIdMsg.timeCreated}`
      : `fit_${filename.replace(/\.fit$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`);

  const actName = existingName || 'Singapore Running';

  const lines: string[] = [];
  lines.push('# Garmin Run Export — Parsed for AI Analysis');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('#');
  lines.push(`# Activity: ${actName}`);
  lines.push(`# Activity ID: ${actId}`);
  lines.push(`# Date: ${startDateLocal}`);
  lines.push('# Sport: running');
  if (session?.total_distance != null) lines.push(`# Total Distance (m): ${session.total_distance}`);
  if (session?.total_timer_time != null) lines.push(`# Total Duration (s): ${session.total_timer_time}`);
  if (session?.total_elapsed_time != null) lines.push(`# Total Elapsed Time (s): ${session.total_elapsed_time}`);
  if (session?.avg_heart_rate != null) lines.push(`# Avg Heart Rate (bpm): ${session.avg_heart_rate}`);
  if (session?.max_heart_rate != null) lines.push(`# Max Heart Rate (bpm): ${session.max_heart_rate}`);
  if (session?.avg_cadence != null) lines.push(`# Avg Cadence (spm): ${session.avg_cadence * 2}`);
  if (session?.max_cadence != null) lines.push(`# Max Cadence (spm): ${session.max_cadence * 2}`);
  if (session?.avg_speed != null) lines.push(`# Avg Speed (m/s): ${session.avg_speed}`);
  if (session?.max_speed != null) lines.push(`# Max Speed (m/s): ${session.max_speed}`);
  if (session?.total_calories != null) lines.push(`# Calories: ${session.total_calories}`);
  if (session?.total_ascent != null) lines.push(`# Total Ascent (m): ${session.total_ascent}`);
  if (session?.total_descent != null) lines.push(`# Total Descent (m): ${session.total_descent}`);
  if (session?.avg_vertical_oscillation != null) {
    lines.push(`# Avg Vertical Oscillation (cm): ${(session.avg_vertical_oscillation / 10).toFixed(1)}`);
  }
  if (session?.avg_stance_time != null) {
    lines.push(`# Avg Ground Contact Time (ms): ${session.avg_stance_time}`);
  }
  lines.push('#');

  // Columns
  const headerCols = [
    'timestamp',
    'heart_rate',
    'cadence',
    'speed',
    'distance',
    'altitude',
    'latitude',
    'longitude',
    'temperature',
    'vertical_oscillation',
    'stance_time',
  ];
  lines.push(headerCols.join(','));

  for (const r of records) {
    const ts = r.timestamp != null ? formatLocalISO(r.timestamp) : '';
    const hr = r.heart_rate ?? '';
    const cad = r.cadence != null ? r.cadence * 2 : '';
    const spd = r.enhanced_speed ?? r.speed ?? '';
    const dist = r.distance ?? '';
    const alt = r.enhanced_altitude ?? r.altitude ?? '';
    const lat = r.position_lat ?? '';
    const lon = r.position_long ?? '';
    const temp = r.temperature ?? '';
    const vo = r.vertical_oscillation ?? '';
    const st = r.stance_time ?? '';

    lines.push(`${ts},${hr},${cad},${spd},${dist},${alt},${lat},${lon},${temp},${vo},${st}`);
  }

  return {
    isRunning: true,
    sport: session?.sport ?? 1,
    subSport: session?.sub_sport ?? 0,
    csv: lines.join('\n'),
    dateStr: startDateLocal,
    distanceM,
    durationS,
    avgHr: session?.avg_heart_rate ?? null,
    maxHr: session?.max_heart_rate ?? null,
    avgCadence: session?.avg_cadence ? session.avg_cadence * 2 : null,
    recordCount: records.length,
  };
}
