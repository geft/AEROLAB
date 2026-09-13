import crypto from 'crypto';

export interface ActivityMetadata {
  id: string;
  name: string;
  date: string;
  sport: string;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  totalElapsedSeconds: number;
  avgHeartRate: number;
  maxHeartRate: number;
  avgCadence: number;
  maxCadence: number;
  calories: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
}

export interface ActivityRecord {
  timestamp: string;
  elapsedSeconds: number;
  heartRate: number | null;
  cadence: number | null;
  speedMps: number | null;
  distanceMeters: number | null;
  altitudeMeters: number | null;
  latitude: number | null;
  longitude: number | null;
  temperature: number | null;
  verticalOscillation: number | null;
  stanceTime: number | null;
}

export interface ParsedCSV {
  fileHash: string;
  metadata: ActivityMetadata;
  records: ActivityRecord[];
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
  const date = rawMeta['Date'] || new Date().toISOString();
  const sport = rawMeta['Sport'] || 'running';
  const totalDistanceMeters = parseFloat(rawMeta['Total Distance (m)'] || '0');
  const totalDurationSeconds = parseFloat(rawMeta['Total Duration (s)'] || '0');
  const totalElapsedSeconds = parseFloat(rawMeta['Total Elapsed Time (s)'] || rawMeta['Total Duration (s)'] || '0');
  const avgHeartRate = parseInt(rawMeta['Avg Heart Rate (bpm)'] || '0', 10);
  const maxHeartRate = parseInt(rawMeta['Max Heart Rate (bpm)'] || '0', 10);
  const avgCadence = parseInt(rawMeta['Avg Cadence (spm)'] || '0', 10);
  const maxCadence = parseInt(rawMeta['Max Cadence (spm)'] || '0', 10);
  const calories = parseInt(rawMeta['Calories'] || '0', 10);
  const totalAscentMeters = parseFloat(rawMeta['Total Ascent (m)'] || '0');
  const totalDescentMeters = parseFloat(rawMeta['Total Descent (m)'] || '0');

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
    const headers = lines[headerIndex].split(',').map(h => h.trim().toLowerCase());
    
    // Header mappings
    const timeIdx = headers.indexOf('timestamp');
    const hrIdx = headers.indexOf('heart_rate');
    const cadIdx = headers.findIndex(h => h.includes('cadence'));
    const speedIdx = headers.findIndex(h => h.includes('speed'));
    const distIdx = headers.indexOf('distance');
    const altIdx = headers.findIndex(h => h.includes('altitude'));
    const latIdx = headers.findIndex(h => h.includes('lat'));
    const lonIdx = headers.findIndex(h => h.includes('long') || h.includes('lon'));
    const tempIdx = headers.indexOf('temperature');
    const vertOscIdx = headers.findIndex(h => h.includes('vertical_oscillation'));
    const stanceIdx = headers.findIndex(h => h.includes('stance_time'));

    let startTimestampMs = 0;

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      const cols = line.split(',');
      const tsStr = timeIdx !== -1 ? cols[timeIdx]?.trim() : '';
      if (!tsStr) continue;

      const currentMs = new Date(tsStr).getTime();
      if (startTimestampMs === 0 && !isNaN(currentMs)) {
        startTimestampMs = currentMs;
      }
      const elapsedSeconds = startTimestampMs ? Math.max(0, (currentMs - startTimestampMs) / 1000) : records.length;

      records.push({
        timestamp: tsStr,
        elapsedSeconds,
        heartRate: parseNullableInt(hrIdx !== -1 ? cols[hrIdx] : undefined),
        cadence: parseNullableInt(cadIdx !== -1 ? cols[cadIdx] : undefined),
        speedMps: parseNullableFloat(speedIdx !== -1 ? cols[speedIdx] : undefined),
        distanceMeters: parseNullableFloat(distIdx !== -1 ? cols[distIdx] : undefined),
        altitudeMeters: parseNullableFloat(altIdx !== -1 ? cols[altIdx] : undefined),
        latitude: parseNullableFloat(latIdx !== -1 ? cols[latIdx] : undefined),
        longitude: parseNullableFloat(lonIdx !== -1 ? cols[lonIdx] : undefined),
        temperature: parseNullableFloat(tempIdx !== -1 ? cols[tempIdx] : undefined),
        verticalOscillation: parseNullableFloat(vertOscIdx !== -1 ? cols[vertOscIdx] : undefined),
        stanceTime: parseNullableFloat(stanceIdx !== -1 ? cols[stanceIdx] : undefined)
      });
    }
  }

  return { fileHash, metadata, records };
}

function parseNullableFloat(val?: string): number | null {
  if (val === undefined || val === null || val.trim() === '') return null;
  const parsed = parseFloat(val.trim());
  return isNaN(parsed) ? null : parsed;
}

function parseNullableInt(val?: string): number | null {
  if (val === undefined || val === null || val.trim() === '') return null;
  const parsed = parseInt(val.trim(), 10);
  return isNaN(parsed) ? null : parsed;
}

function pathFallbackId(filename: string, dateStr?: string): string {
  const base = filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  if (dateStr) {
    const d = dateStr.replace(/[^0-9]/g, '');
    return `${base}_${d}`;
  }
  return base || `activity_${Date.now()}`;
}
