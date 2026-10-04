import { describe, expect, it } from 'vitest';
import { intensityAudit } from '../../src/backend/physiology/coaching/evidence.js';
import { extractSteadyStateMetrics } from '../../src/backend/physiology/economy.js';

const times = (steps: number[], end = 240) => {
  const result = [0];
  for (let i = 0; result.at(-1)! < end; i++) result.push(Math.min(end, result.at(-1)! + steps[i % steps.length]));
  return result;
};
const trace = (steps: number[]) => times(steps).map(elapsedSeconds => ({
  elapsedSeconds, heartRate: 130 + elapsedSeconds / 6, cadence: 175, timerSegment: 0
}));

describe('duration-weighted intensity', () => {
  it('keeps coverage, temporal halves and bands comparable across recording densities', () => {
    const baseline = intensityAudit(trace([1]), { lt1Hr: 148 })!;
    expect(baseline.sampledSec).toBe(240);
    expect(baseline.aboveCeilingPct).toBeGreaterThan(40);
    expect(baseline.firstHalfAboveCeilingPct).toBeLessThan(baseline.secondHalfAboveCeilingPct);
    for (const steps of [[5], [2, 7, 3, 11]]) expect(intensityAudit(trace(steps), { lt1Hr: 148 })).toEqual(baseline);
  });

  it('uses seconds for the minimum coverage and retains fractional durations', () => {
    expect(intensityAudit(times([5], 30).map(elapsedSeconds => ({ elapsedSeconds, heartRate: 130 })), { lt1Hr: 148 })?.sampledSec).toBe(30);
    expect(intensityAudit(times([1], 29).map(elapsedSeconds => ({ elapsedSeconds, heartRate: 130 })), { lt1Hr: 148 })).toBeNull();
    expect(intensityAudit(times([2.5], 32.5).map(elapsedSeconds => ({ elapsedSeconds, heartRate: 130 })), { lt1Hr: 148 })?.sampledSec).toBe(32.5);
  });

  it.each([[1], [5], [2, 7, 3, 11]])('fences stops, gaps, missing HR and walking at density %j', (...steps) => {
    const records = [
      ...times(steps, 60).map(elapsedSeconds => ({ elapsedSeconds, heartRate: 130, cadence: 175, timerSegment: 0 })),
      ...times(steps, 60).map(t => ({ elapsedSeconds: 100 + t, heartRate: 190, cadence: 175, timerSegment: 1, timerActive: false })),
      ...times(steps, 60).map(t => ({ elapsedSeconds: 200 + t, heartRate: 170, cadence: 175, timerSegment: 2 }))
    ];
    expect(intensityAudit(records, { lt1Hr: 148 })).toMatchObject({ sampledSec: 120, aboveCeilingPct: 50, firstHalfAboveCeilingPct: 0, secondHalfAboveCeilingPct: 100 });
    const invalid = records.map(r => r.elapsedSeconds >= 200 ? { ...r, heartRate: NaN } : r);
    expect(intensityAudit(invalid, { lt1Hr: 148 })?.sampledSec).toBe(60);
    expect(intensityAudit(records.map(r => r.elapsedSeconds >= 200 ? { ...r, cadence: 90 } : r), { lt1Hr: 148 })?.sampledSec).toBe(60);
  });
});

it('preserves legacy economy inputs and absent-sensor behavior', () => {
  const camel = times([5], 60).map(elapsedSeconds => ({ elapsedSeconds, speedMps: 3, heartRate: 140, distanceMeters: elapsedSeconds * 3 }));
  const legacy = camel.map(r => ({ elapsed_seconds: r.elapsedSeconds, speed_mps: r.speedMps, heart_rate: r.heartRate, distance_m: r.distanceMeters }));
  expect(extractSteadyStateMetrics(legacy)).toEqual(extractSteadyStateMetrics(camel));
  expect(extractSteadyStateMetrics([{ elapsed_seconds: 0 }, { elapsed_seconds: 5 }]).steadyHeartRate).toBeNull();
});
