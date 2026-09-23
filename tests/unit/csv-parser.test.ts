import { describe, it, expect } from 'vitest';
import { parseRunCSV } from '../../src/backend/ingestion/csv-parser';
import { getBenchmark, toCsv } from '../fixtures/benchmark-runs';

describe('CSV Parser', () => {
  const benchmarkCsv = toCsv(getBenchmark('bench-easy-60'));

  it('correctly parses activity metadata headers', () => {
    const result = parseRunCSV(benchmarkCsv, 'bench-easy-60.csv');

    expect(result.metadata.id).toBe('bench-easy-60');
    expect(result.metadata.name).toBe('Benchmark Easy Aerobic');
    expect(result.metadata.totalDistanceMeters).toBeCloseTo(11880, 0);
    expect(result.metadata.totalDurationSeconds).toBe(3599);
    expect(result.metadata.avgHeartRate).toBe(138);
    expect(result.metadata.maxHeartRate).toBe(139);
    expect(result.metadata.avgCadence).toBe(178);
  });

  it('correctly parses time-series records and running dynamics', () => {
    const result = parseRunCSV(benchmarkCsv, 'bench-easy-60.csv');

    expect(result.records.length).toBe(3600);
    const first = result.records[0];
    expect(first.timestamp).toBe('2026-09-10T07:00:00');
    expect(first.heartRate).toBe(138);
    expect(first.cadence).toBe(178);
    expect(first.speedMps).toBe(3.3);
    expect(first.temperature).toBe(29);
    expect(first.verticalOscillation).toBe(70);
    expect(first.stanceTime).toBe(230);
  });

  it('generates fallback IDs when Activity ID is omitted with or without date', () => {
    const csvWithDate = `
# Activity: Lunch Jog
# Date: 2026-09-12 12:30:00
timestamp,heart_rate,cadence,speed,distance
2026-09-12T12:30:00,130,160,3.0,10
`;
    const resWithDate = parseRunCSV(csvWithDate, 'lunch-jog.csv');
    expect(resWithDate.metadata.id).toBe('lunch-jog_20260912123000');

    const csvNoDate = `
timestamp,heart_rate,cadence,speed,distance
2026-09-12T12:30:00,130,160,3.0,10
`;
    const resNoDate = parseRunCSV(csvNoDate, 'simple.csv');
    expect(resNoDate.metadata.id).toBe('simple');
  });

  it('handles null, undefined, empty, or unparseable dynamic values in records', () => {
    const rawCsv = `
timestamp,heart_rate,cadence,speed,distance,altitude,temperature,vertical_oscillation,ground_contact_time
2026-09-12T12:30:00,,,invalid,,nan, ,abc,
`;
    const res = parseRunCSV(rawCsv, 'corrupted_fields.csv');
    expect(res.records.length).toBe(1);
    const r = res.records[0];
    expect(r.heartRate).toBeNull();
    expect(r.cadence).toBeNull();
    expect(r.speedMps).toBeNull();
    expect(r.altitudeMeters).toBeNull();
    expect(r.temperature).toBeNull();
    expect(r.verticalOscillation).toBeNull();
    expect(r.stanceTime).toBeNull();
  });

  it('does not pass invalid timestamps or infinite sensor values into analysis', () => {
    const parsed = parseRunCSV(`timestamp,heart_rate,speed,distance\ninvalid,140,3,10\n2026-09-12T12:30:00,Infinity,Infinity,10`, 'invalid.csv');
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].heartRate).toBeNull();
    expect(parsed.records[0].speedMps).toBeNull();
    expect(Number.isFinite(parsed.records[0].elapsedSeconds)).toBe(true);
  });
});
