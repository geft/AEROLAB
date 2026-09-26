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

  it('applies metadata defaults, flattens line breaks, preserves null cells, and ends with a newline', () => {
    const activity = {
      id: 'id\nwith\rbreaks', name: '', start_time: '2026-09-24\n19:02', sport: '',
      duration_seconds: 42, elapsed_seconds: null,
    } as Activity;
    const header = 'timestamp,heart_rate,cadence (spm),enhanced_speed,distance,enhanced_altitude,position_lat,position_long,temperature,vertical_oscillation,stance_time';
    const csv = sessionToCsv(activity, [
      { timestamp: 'time', elapsed_seconds: 0, heart_rate: null, cadence: null, speed_mps: null, distance_m: null, altitude_m: null, lat: null, lon: null, temp: null, vert_osc: null, stance_time: null },
      { timestamp: 'later', elapsed_seconds: 1, heart_rate: 150, cadence: 170, speed_mps: 3, distance_m: 3, altitude_m: 4, lat: 1, lon: 2, temp: 20, vert_osc: 8, stance_time: 240 },
    ] satisfies ActivityRecord[]);

    expect(csv).toContain('# Activity: Run\n# Activity ID: id with breaks\n# Date: 2026-09-24 19:02\n# Sport: running');
    expect(csv).toContain('# Total Elapsed Time (s): 42');
    expect(csv).toContain(`${header}\ntime,,,,,,,,,,\nlater,150,170,3,3,4,1,2,20,8,240\n`);
    expect(sessionToCsv(activity, [])).toContain(`${header}\n`);
    expect(sessionToCsv(activity, [])).toMatch(/\n$/);
  });
});
