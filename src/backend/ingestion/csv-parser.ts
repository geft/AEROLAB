import crypto from 'crypto';

import type { ActivityMetadata, ActivityRecord } from '../domain/telemetry.js';
export type { ActivityMetadata, ActivityRecord } from '../domain/telemetry.js';

export interface ParsedCSV {
  fileHash: string;
  metadata: ActivityMetadata;
  records: ActivityRecord[];
  fitMetadata?: Record<string, unknown>;
  sourceFit?: Buffer;
}

export function parseRunCSV(content: string, filename: string): ParsedCSV {
  const fileHash = crypto.createHash('sha256').update(content).digest('hex');
  const lines = content.split(/\r?\n/);

  const rawMeta: Record<string, string> = {};
  let headerIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      const match = line.replace(/^#\s*/, '').match(/^([^:]+):\s*(.*)$/);
      if (match) {
        rawMeta[match[1].trim()] = match[2].trim();
      }
    } else {
      headerIndex = i;
      break;
    }
  }

  const id = rawMeta['Activity ID'] || pathFallbackId(filename, rawMeta['Date']);
  const name = rawMeta['Activity'] || 'Run';
  const suppliedDate = rawMeta['Date'];
  if (suppliedDate && !Number.isFinite(Date.parse(suppliedDate))) {
    throw new Error('Invalid activity date in CSV metadata');
  }
  const date = suppliedDate || new Date().toISOString();
  const sport = rawMeta['Sport'] || 'running';
  const metric = (key: string, integer = false): number => {
    const raw = rawMeta[key];
    if (raw === undefined || raw === '') return 0;
    const parsed = integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid ${key} in CSV metadata`);
    return parsed;
  };
  const totalDistanceMeters = metric('Total Distance (m)');
  const totalDurationSeconds = metric('Total Duration (s)');
  const totalElapsedSeconds = rawMeta['Total Elapsed Time (s)']
    ? metric('Total Elapsed Time (s)') : totalDurationSeconds;
  const avgHeartRate = metric('Avg Heart Rate (bpm)', true);
  const maxHeartRate = metric('Max Heart Rate (bpm)', true);
  const avgCadence = metric('Avg Cadence (spm)');
  const maxCadence = metric('Max Cadence (spm)');
  const calories = metric('Calories', true);
  const totalAscentMeters = metric('Total Ascent (m)');
  const totalDescentMeters = metric('Total Descent (m)');

  const metadata: ActivityMetadata = {
    id,
    name,
    date,
    sport,
    totalDistanceMeters,
    totalDurationSeconds,
    totalElapsedSeconds,
    avgHeartRate,
    maxHeartRate,
    avgCadence,
    maxCadence,
    calories,
    totalAscentMeters,
    totalDescentMeters
  };

  const records: ActivityRecord[] = [];

  if (headerIndex !== -1 && headerIndex < lines.length) {
    const headers = splitCsvLine(lines[headerIndex]).map(h => h.trim().toLowerCase());
    
    // Header mappings
    const timeIdx = headers.indexOf('timestamp');
    const hrIdx = headers.indexOf('heart_rate');
    const cadIdx = headers.findIndex(h => h.includes('cadence'));
    const speedIdx = headers.includes('enhanced_speed') ? headers.indexOf('enhanced_speed') : headers.findIndex(h => h.includes('speed'));
    const distIdx = headers.indexOf('distance');
    const altIdx = headers.includes('enhanced_altitude') ? headers.indexOf('enhanced_altitude') : headers.findIndex(h => h.includes('altitude'));
    const latIdx = headers.findIndex(h => h.includes('lat'));
    const lonIdx = headers.findIndex(h => h.includes('long') || h.includes('lon'));
    const tempIdx = headers.indexOf('temperature');
    const vertOscIdx = headers.findIndex(h => h.includes('vertical_oscillation'));
    const stanceIdx = headers.indexOf('stance_time');
    const stepLenIdx = headers.findIndex(h => h.includes('step_length'));

    let startTimestampMs = 0;

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      const cols = splitCsvLine(line);
      const tsStr = timeIdx !== -1 ? cols[timeIdx]?.trim() : '';
      if (!tsStr) continue;

      const currentMs = new Date(tsStr).getTime();
      if (!Number.isFinite(currentMs)) continue;
      if (startTimestampMs === 0 && !isNaN(currentMs)) {
        startTimestampMs = currentMs;
      }
      const elapsedSeconds = startTimestampMs ? Math.max(0, (currentMs - startTimestampMs) / 1000) : records.length;

      records.push({
        timestamp: tsStr,
        elapsedSeconds,
        heartRate: parseNullableInt(hrIdx !== -1 ? cols[hrIdx] : undefined),
        cadence: parseNullableFloat(cadIdx !== -1 ? cols[cadIdx] : undefined),
        speedMps: parseNullableFloat(speedIdx !== -1 ? cols[speedIdx] : undefined),
        distanceMeters: parseNullableFloat(distIdx !== -1 ? cols[distIdx] : undefined),
        altitudeMeters: parseNullableFloat(altIdx !== -1 ? cols[altIdx] : undefined),
        latitude: parseNullableFloat(latIdx !== -1 ? cols[latIdx] : undefined),
        longitude: parseNullableFloat(lonIdx !== -1 ? cols[lonIdx] : undefined),
        temperature: parseNullableFloat(tempIdx !== -1 ? cols[tempIdx] : undefined),
        verticalOscillation: parseNullableFloat(vertOscIdx !== -1 ? cols[vertOscIdx] : undefined),
        stanceTime: parseNullableFloat(stanceIdx !== -1 ? cols[stanceIdx] : undefined),
        stepLength: parseNullableFloat(stepLenIdx !== -1 ? cols[stepLenIdx] : undefined),
        fractionalCadence: parseNullableFloat(cols[headers.indexOf('fractional_cadence')]),
        power: parseNullableFloat(cols[headers.indexOf('power')]),
        verticalRatio: parseNullableFloat(cols[headers.indexOf('vertical_ratio')]),
        stanceTimeBalance: parseNullableFloat(cols[headers.indexOf('stance_time_balance')]),
        respirationRate: parseNullableFloat(cols[headers.indexOf('respiration_rate')]),
        coreTemperature: parseNullableFloat(cols[headers.indexOf('core_temperature')]),
        fitFields: rawMeta['FIT Export Version'] ? decodeFitFields(headers, cols) : undefined,
      });
    }
  }

  const fitMetadata = rawMeta['FIT Metadata'] ? JSON.parse(rawMeta['FIT Metadata']) as Record<string, unknown> : undefined;
  repairSpeedTelemetry(records);
  return { fileHash, metadata, records, fitMetadata };
}

/** Both native FIT and legacy CSV ingestion use the same telemetry repair. */
export function repairSpeedTelemetry(records: ActivityRecord[]): void {
  // Detect and repair broken/flat speed telemetry (e.g. FIT exports where speed was recorded as a static cumulative average)
  if (records.length >= 20) {
    const validSpeeds = records.map(r => r.speedMps).filter((s): s is number => s !== null && s > 0);
    const hasDistances = records.filter(r => r.distanceMeters !== null && r.distanceMeters > 0).length >= 20;

    let isBrokenSpeed = false;
    if (validSpeeds.length >= 20) {
      const minS = Math.min(...validSpeeds);
      const maxS = Math.max(...validSpeeds);
      // Flat speed across the entire run despite varied cadence or interval effort
      if (maxS - minS < 0.15 && minS > 1.0) {
        isBrokenSpeed = true;
      }
    } else if (validSpeeds.length === 0 && hasDistances) {
      isBrokenSpeed = true;
    }

    if (isBrokenSpeed && hasDistances) {
      // Reconstruct instantaneous speed from smoothed delta distance / delta time
      const windowSec = 5; // 5-second moving window for realistic instantaneous pace
      for (let i = 0; i < records.length; i++) {
        const cur = records[i];
        if (cur.distanceMeters === null) continue;

        // Find window boundary records
        let prevIdx = i;
        while (prevIdx > 0 && cur.elapsedSeconds - records[prevIdx].elapsedSeconds < windowSec) {
          prevIdx--;
        }
        let nextIdx = i;
        while (nextIdx < records.length - 1 && records[nextIdx].elapsedSeconds - cur.elapsedSeconds < windowSec) {
          nextIdx++;
        }

        const prev = records[prevIdx];
        const next = records[nextIdx];
        if (prev.distanceMeters !== null && next.distanceMeters !== null) {
          const dt = next.elapsedSeconds - prev.elapsedSeconds;
          const dd = next.distanceMeters - prev.distanceMeters;
          if (dt >= 2 && dd >= 0) {
            const derivedSpd = dd / dt;
            // Bound realistic human running velocity: 0 to 9 m/s (~1:51/km)
            cur.speedMps = Number(Math.max(0, Math.min(9.0, derivedSpd)).toFixed(3));
          }
        }
      }
    }
  }

}

/** Keep raw fields flat across repeated database CSV exports and reimports. */
function decodeFitFields(headers: string[], cells: string[]): Record<string, unknown> {
  const fields = Object.fromEntries(headers.map((key, index) => {
    const value = cells[index];
    if (value?.startsWith('{') || value?.startsWith('[')) return [key, JSON.parse(value)];
    return [key, value === '' || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : value];
  }));
  const { fit_fields: saved, ...columns } = fields;
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...columns, ...saved } : columns;
}

/** RFC 4180 cells, including JSON developer fields containing commas/quotes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('Unterminated CSV quoted field');
  cells.push(cell);
  return cells;
}

function parseNullableFloat(val?: string): number | null {
  if (val === undefined || val === null || val.trim() === '') return null;
  const parsed = parseFloat(val.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableInt(val?: string): number | null {
  if (val === undefined || val === null || val.trim() === '') return null;
  const parsed = parseInt(val.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function pathFallbackId(filename: string, dateStr?: string): string {
  const base = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  if (dateStr) {
    const d = dateStr.replace(/[^0-9]/g, '');
    return `${base}_${d}`;
  }
  return base || `activity_${Date.now()}`;
}
