import { describe, expect, it } from 'vitest';
import { calculateRunningHrExposure } from '../../src/backend/physiology/economy';
import type { ActivityRecord } from '../../src/backend/ingestion/csv-parser';

function record(elapsedSeconds: number, heartRate: number | null, overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    timestamp: new Date(1700000000000 + elapsedSeconds * 1000).toISOString(),
    elapsedSeconds, heartRate, cadence: 165, speedMps: 3,
    distanceMeters: elapsedSeconds * 3, altitudeMeters: 0,
    latitude: null, longitude: null, temperature: null,
    verticalOscillation: null, stanceTime: null, ...overrides
  };
}

const exposure = (records: ActivityRecord[]) => calculateRunningHrExposure(records, 140, 153);

describe('Recovery running HR exposure', () => {
  it.each([
    [140, 0, 0],
    [140.01, 100, 0],
    [152.99, 100, 0],
    [153, 100, 100]
  ])('treats HR %s with strict HRR and inclusive LT1 boundaries', (hr, aboveCeilingPct, atOrAboveLt1Pct) => {
    expect(exposure([record(0, hr), record(10, hr)])).toMatchObject({
      runningSeconds: 10, avgHr: hr, aboveCeilingPct, atOrAboveLt1Pct
    });
  });

  it.each([[130, 160], [160, 130]])('integrates HR crossings from %s to %s', (start, end) => {
    const result = exposure([record(0, start), record(12, end)]);
    expect(result.runningSeconds).toBe(12);
    expect(result.avgHr).toBe(145);
    expect(result.aboveCeilingPct).toBeCloseTo(100 * 20 / 30);
    expect(result.atOrAboveLt1Pct).toBeCloseTo(100 * 7 / 30);
  });

  it('weights irregular intervals by elapsed time, not sample count', () => {
    // 10 seconds at 130, a 2-second rise, then 3 seconds at 160.
    const result = exposure([record(0, 130), record(10, 130), record(12, 160), record(15, 160)]);
    expect(result.runningSeconds).toBe(15);
    expect(result.avgHr).toBe(138);
    expect(result.aboveCeilingPct).toBeCloseTo((2 * 2 / 3 + 3) / 15 * 100);
    expect(result.atOrAboveLt1Pct).toBeCloseTo((2 * 7 / 30 + 3) / 15 * 100);
  });

  it('does not invent intensity evidence across gaps exceeding 15 seconds', () => {
    expect(exposure([record(0, 130), record(15, 130), record(100, 160), record(105, 160)]))
      .toMatchObject({ runningSeconds: 20, avgHr: 137.5, aboveCeilingPct: 25, atOrAboveLt1Pct: 25 });
  });

  it.each([0, -1, 16])('ignores a non-observed interval of %s seconds', seconds => {
    expect(exposure([record(0, 130), record(seconds, 130)])).toMatchObject({
      runningSeconds: 0, avgHr: null, aboveCeilingPct: null, atOrAboveLt1Pct: null
    });
  });

  it.each([null, NaN, Infinity, 0, 40, 241])('excludes invalid HR %s without losing running duration', hr => {
    const result = exposure([record(0, hr), record(5, hr), record(10, 130), record(15, 130)]);
    expect(result).toMatchObject({ runningSeconds: 15, avgHr: 130, aboveCeilingPct: 0, atOrAboveLt1Pct: 0 });
  });

  it('excludes walking and stops, including their low HR at the transition to running', () => {
    const result = exposure([
      record(0, 90, { cadence: 0, speedMps: 0 }),
      record(5, 90, { cadence: 0, speedMps: 0 }),
      record(10, 100, { cadence: 110, speedMps: 1.2 }),
      record(15, 160), record(20, 160)
    ]);
    // A movement transition has unknown duration; only paired running endpoints count.
    expect(result).toMatchObject({ runningSeconds: 5, avgHr: 160, aboveCeilingPct: 100, atOrAboveLt1Pct: 100 });
  });

  it('uses cadence to recognize slow running', () => {
    expect(exposure([record(0, 130, { speedMps: 1.4 }), record(10, 130, { speedMps: 1.4 })]).runningSeconds).toBe(10);
  });

  it('falls back to speed when cadence is unavailable', () => {
    const records = [
      record(0, 90, { cadence: null, speedMps: 0 }),
      record(5, 100, { cadence: null, speedMps: 1.2 }),
      record(10, 130, { cadence: null }), record(15, 130, { cadence: null })
    ];
    expect(exposure(records)).toMatchObject({ runningSeconds: 5, avgHr: 130, aboveCeilingPct: 0, atOrAboveLt1Pct: 0 });
  });

  it.each([{ records: [] }, { records: [record(0, 130)] }])('requires an observed interval', ({ records }) => {
    expect(exposure(records)).toMatchObject({ runningSeconds: 0, avgHr: null, aboveCeilingPct: null, atOrAboveLt1Pct: null });
  });
});
