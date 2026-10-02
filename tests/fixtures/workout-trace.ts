import type { ActivityMetadata, ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';

export interface TraceBlock {
  seconds: number;
  hr: number | null | ((secondsIntoBlock: number) => number | null);
  speed?: number;
  cadence?: number;
}

/** A telemetry builder with explicit elapsed time and integrated distance.
 * Its inputs describe a workout, without using classifier gates to create it.
 */
export function workoutTrace(blocks: TraceBlock[], options: { id?: string; date?: string; steps?: number[] } = {}) {
  const date = options.date ?? '2026-02-02 12:00:00';
  const start = new Date(date.replace(' ', 'T')).getTime();
  const steps = options.steps ?? [1];
  const records: ActivityRecord[] = [];
  let elapsedSeconds = 0, distanceMeters = 0, hrTime = 0, hrSeconds = 0;
  const append = (block: TraceBlock, into: number) => {
    const hr = typeof block.hr === 'function' ? block.hr(into) : block.hr;
    records.push({ timestamp: new Date(start + elapsedSeconds * 1000).toISOString(), elapsedSeconds,
      heartRate: hr, cadence: block.cadence ?? 175, speedMps: block.speed ?? 3,
      distanceMeters, altitudeMeters: null, latitude: null, longitude: null,
      temperature: null, stanceTime: 240, verticalOscillation: 7 });
    return hr;
  };
  for (const block of blocks) {
    for (let into = 0; into < block.seconds;) {
      const hr = append(block, into);
      const dt = Math.min(steps[(records.length - 1) % steps.length], block.seconds - into);
      if (hr != null && Number.isFinite(hr) && hr > 40 && hr <= 240) { hrTime += hr * dt; hrSeconds += dt; }
      distanceMeters += (block.speed ?? 3) * dt;
      elapsedSeconds += dt;
      into += dt;
    }
  }
  if (blocks.length) append(blocks.at(-1)!, blocks.at(-1)!.seconds);
  const metadata: ActivityMetadata = {
    id: options.id ?? 'synthetic-trace', name: 'Running', date, sport: 'running',
    totalDistanceMeters: distanceMeters, totalDurationSeconds: elapsedSeconds, totalElapsedSeconds: elapsedSeconds,
    avgHeartRate: hrSeconds ? Math.round(hrTime / hrSeconds) : 0,
    maxHeartRate: Math.max(0, ...records.map(r => r.heartRate ?? 0).filter(v => Number.isFinite(v) && v <= 240)),
    avgCadence: 175, maxCadence: 185, calories: 0, totalAscentMeters: 0, totalDescentMeters: 0
  };
  return { metadata, records };
}

export function traceCsv(trace: ReturnType<typeof workoutTrace>): string {
  const { metadata: m, records } = trace;
  return [
    `# Activity ID: ${m.id}`, `# Activity: ${m.name}`, `# Date: ${m.date}`, '# Sport: running',
    `# Total Distance (m): ${m.totalDistanceMeters}`, `# Total Duration (s): ${m.totalDurationSeconds}`,
    `# Avg Heart Rate (bpm): ${m.avgHeartRate}`, `# Max Heart Rate (bpm): ${m.maxHeartRate}`,
    'timestamp,heart_rate,cadence,speed,distance',
    ...records.map(r => [r.timestamp, r.heartRate ?? '', r.cadence, r.speedMps, r.distanceMeters].join(','))
  ].join('\n');
}
