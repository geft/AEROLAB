import { describe, expect, it } from 'vitest';
import type { ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';
import { calculateKmSplits } from '../../src/backend/physiology/economy.js';

function record(distanceMeters: number, elapsedSeconds = distanceMeters / 4, overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    timestamp: '', elapsedSeconds, distanceMeters, speedMps: 4,
    heartRate: 140, cadence: 180, altitudeMeters: distanceMeters / 100,
    latitude: null, longitude: null, temperature: null,
    verticalOscillation: 80, stanceTime: 240, ...overrides
  };
}

describe('Distance splits', () => {
  it('interpolates exact kilometre boundaries and preserves total distance and time', () => {
    const splits = calculateKmSplits([0, 330, 660, 990, 1320, 1650, 1980, 2310, 2500].map(d => record(d)));
    expect(splits.map(s => s.distanceMeters)).toEqual([1000, 1000, 500]);
    expect(splits.map(s => s.durationSeconds)).toEqual([250, 250, 125]);
    expect(splits.reduce((sum, s) => sum + s.distanceMeters, 0)).toBe(2500);
    expect(splits.reduce((sum, s) => sum + s.durationSeconds, 0)).toBe(625);
    expect(splits.map(s => s.elevationChangeM)).toEqual([10, 10, 5]);
  });

  it('handles multiple boundaries within one sparse sampling interval', () => {
    const splits = calculateKmSplits([record(0), record(2500)]);
    expect(splits.map(s => s.distanceMeters)).toEqual([1000, 1000, 500]);
    expect(splits.map(s => s.avgPaceSecKm)).toEqual([250, 250, 250]);
  });

  it('keeps exact finishes free of a phantom one-metre final split', () => {
    const splits = calculateKmSplits([0, 1000, 2000].map(d => record(d)));
    expect(splits).toHaveLength(2);
    expect(splits.map(s => s.distanceMeters)).toEqual([1000, 1000]);
  });

  it('measures distance relative to the first sample', () => {
    const splits = calculateKmSplits([record(500, 100), record(1500, 350), record(2000, 475)]);
    expect(splits.map(s => s.distanceMeters)).toEqual([1000, 500]);
    expect(splits.map(s => s.durationSeconds)).toEqual([250, 125]);
  });

  it('weights heart rate by elapsed time and derives pace from distance and time', () => {
    const splits = calculateKmSplits([
      record(0, 0, { heartRate: 100, speedMps: 6 }),
      record(100, 10, { heartRate: 100, speedMps: 6 }),
      record(1000, 100, { heartRate: 180, speedMps: 6 })
    ]);
    expect(splits[0].avgHeartRate).toBe(136);
    expect(splits[0].avgPaceSecKm).toBe(100);
  });

  it('includes stationary time within a split', () => {
    const splits = calculateKmSplits([record(0, 0), record(500, 125), record(500, 155), record(1000, 280)]);
    expect(splits[0].durationSeconds).toBe(280);
    expect(splits[0].avgPaceSecKm).toBe(280);
  });

  it('does not bridge invalid readings or a reset in cumulative distance', () => {
    expect(calculateKmSplits([record(0), record(0, 10, { distanceMeters: null }), record(1000, 250)])).toEqual([]);
    const splits = calculateKmSplits([record(0, 0), record(500, 125), record(0, 126), record(500, 251)]);
    expect(splits.map(s => s.distanceMeters)).toEqual([500, 500]);
    expect(splits.map(s => s.durationSeconds)).toEqual([125, 125]);
  });

  it.each([0, -1000, NaN, Infinity])('rejects invalid split distance %s', distance => {
    expect(calculateKmSplits([record(0), record(1000)], distance)).toEqual([]);
  });

  it('does not emit a split for one sample or no movement', () => {
    expect(calculateKmSplits([record(0)])).toEqual([]);
    expect(calculateKmSplits([record(0, 0), record(0, 10)])).toEqual([]);
  });
});
