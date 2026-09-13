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
});
