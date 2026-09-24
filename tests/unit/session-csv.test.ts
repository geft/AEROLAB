import { describe, expect, it } from 'vitest';
import { parseRunCSV } from '../../src/backend/ingestion/csv-parser.js';
import { sessionToCsv } from '../../src/frontend/utils/sessionCsv.js';
import type { Activity, ActivityRecord } from '../../src/frontend/types/api.js';

describe('session CSV export', () => {
  it('exports metadata and retained telemetry in an importable layout', () => {
    const activity = {
      id: 'run-42', name: 'Threshold', start_time: '2026-09-24 19:02:28', sport: 'running',
      distance_meters: 1000, duration_seconds: 300, elapsed_seconds: 300,
      avg_heart_rate: 150, max_heart_rate: 160, avg_cadence: 170, max_cadence: 180,
    } as Activity;
    const records = [
      { timestamp: '2026-09-24T19:02:28.000', elapsed_seconds: 0, heart_rate: 140, cadence: 170, speed_mps: 3.2, distance_m: 0, altitude_m: 18, lat: null, lon: null, temp: null, vert_osc: null, stance_time: null },
      { timestamp: '2026-09-24T19:07:28.000', elapsed_seconds: 300, heart_rate: 160, cadence: 180, speed_mps: 3.4, distance_m: 1000, altitude_m: 19, lat: null, lon: null, temp: null, vert_osc: null, stance_time: null },
    ] satisfies ActivityRecord[];

    const parsed = parseRunCSV(sessionToCsv(activity, records), 'export.csv');
    expect(parsed.metadata.id).toBe('run-42');
    expect(parsed.metadata.totalDistanceMeters).toBe(1000);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[1].heartRate).toBe(160);
    expect(parsed.records[1].distanceMeters).toBe(1000);
  });
});
