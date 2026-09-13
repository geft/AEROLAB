import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseRunCSV } from '../../src/backend/ingestion/csv-parser';

describe('CSV Parser', () => {
  const samplePath = path.resolve(__dirname, '../fixtures/sample-run.csv');
  const sampleContent = fs.readFileSync(samplePath, 'utf8');

  it('correctly parses activity metadata headers', () => {
    const result = parseRunCSV(sampleContent, 'sample-run.csv');
    
    expect(result.metadata.id).toBe('24321232759');
    expect(result.metadata.name).toBe('Singapore Running');
    expect(result.metadata.totalDistanceMeters).toBe(8598.59);
    expect(result.metadata.totalDurationSeconds).toBe(3746.928);
    expect(result.metadata.avgHeartRate).toBe(130);
    expect(result.metadata.maxHeartRate).toBe(142);
    expect(result.metadata.avgCadence).toBe(156);
    expect(result.metadata.calories).toBe(481);
    expect(result.metadata.totalAscentMeters).toBe(26);
    expect(result.fileHash).toHaveLength(64); // SHA-256
  });

  it('correctly parses time-series records and running dynamics', () => {
    const result = parseRunCSV(sampleContent, 'sample-run.csv');
    
    expect(result.records.length).toBeGreaterThan(0);
    const first = result.records[0];
    expect(first.timestamp).toBe('2026-09-11T19:50:10.000');
    expect(first.heartRate).toBe(95);
    expect(first.cadence).toBe(122);
    expect(first.speedMps).toBe(1.624);
    expect(first.temperature).toBe(31);
    expect(first.verticalOscillation).toBe(75.2);
    expect(first.stanceTime).toBe(449);
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
});
