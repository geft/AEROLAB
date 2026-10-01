import { describe, expect, it } from 'vitest';
import { calculateEconomy } from '../../src/backend/physiology/economy.js';
import { detectIntervals } from '../../src/backend/ingestion/interval-detector.js';
import type { ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';
import { BENCHMARKS } from '../fixtures/benchmark-runs.js';

function record(t: number, hr = 140, speed = 3, cadence = 175): ActivityRecord {
  return { timestamp: new Date(1700000000000 + t * 1000).toISOString(), elapsedSeconds: t,
    heartRate: hr, speedMps: speed, cadence, distanceMeters: t * speed, altitudeMeters: 0,
    latitude: null, longitude: null, temperature: null, stanceTime: 250, verticalOscillation: 80 };
}

describe('Duration-based algorithm evidence', () => {
  it('keeps economy, duration halves and adaptive warm-up invariant under recording density', () => {
    const trace = (times: number[]) => times.map(t => record(t,
      t <= 180 ? 120 + t / 6 : t <= 900 ? 150 : 150 + (t - 900) / 90));
    // Preserve slope changes, while greatly overrepresenting the beginning in one recording.
    const dense = trace(Array.from({ length: 1801 }, (_, i) => i));
    const sparse = trace(Array.from({ length: 181 }, (_, i) => i * 10));
    const mixed = trace(Array.from({ length: 1801 }, (_, i) => i).filter(t => t <= 600 || t % 10 === 0));
    const reference = calculateEconomy(dense);
    for (const data of [sparse, mixed]) {
      const actual = calculateEconomy(data);
      expect(actual.movingDurationSeconds).toBe(1800);
      expect(actual.movingDistanceMeters).toBe(5400);
      expect(actual.efficiencyFactor).toBeCloseTo(reference.efficiencyFactor!, 4);
      expect(actual.aerobicDecouplingPct).toBeCloseTo(reference.aerobicDecouplingPct!, 2);
      expect(actual.firstHalfEf).toBeCloseTo(reference.firstHalfEf!, 6);
      expect(actual.secondHalfEf).toBeCloseTo(reference.secondHalfEf!, 6);
    }
    expect(reference.aerobicDecouplingPct).toBeGreaterThan(0);
  });

  it('uses paired speed/HR evidence and never bridges sensor gaps or unobserved pauses', () => {
    const data = [record(0), record(10), { ...record(20, 200, 6), heartRate: null },
      record(30, 150), record(40, 150), record(100, 150), record(110, 150)];
    const result = calculateEconomy(data);
    expect(result.movingDurationSeconds).toBe(50);
    expect(result.avgMovingHeartRate).toBe(147); // 10 s at 140 + 20 s at 150
    expect(result.efficiencyFactor).toBeCloseTo(180 / (4400 / 30), 4);
    expect(result.metersPerBeat).toBeCloseTo(result.efficiencyFactor!, 3);
    const stationary = [record(0), record(10), record(20, 140, 0, 0), record(30, 140, 0, 0), record(40), record(50)]
      .map((r, index) => ({ ...r, distanceMeters: [0, 30, 30, 30, 60, 90][index] }));
    const paused = calculateEconomy(stationary);
    expect(paused.pauseBreakdown?.stopDurationSeconds).toBe(20);
    expect(paused.pauseBreakdown?.stopCount).toBe(1);
    expect(paused.movingDurationSeconds).toBe(30);
    expect(paused.efficiencyFactor).toBeCloseTo(180 / 140, 4);
  });

  it('admits sparse race recordings by duration and rejects dense but short recordings', () => {
    const sparse = Array.from({ length: 13 }, (_, i) => record(i * 10, 180));
    expect(detectIntervals(sparse, { isRace: true }).filter(i => i.type === 'work')).toHaveLength(1);
    const short = Array.from({ length: 1000 }, (_, i) => record(i / 100, 180));
    expect(detectIntervals(short, { isRace: true })).toEqual([]);
    const acrossGap = [...sparse.slice(0, 5), ...sparse.slice(5).map(r => ({ ...r, elapsedSeconds: r.elapsedSeconds + 300 }))];
    expect(detectIntervals(acrossGap, { isRace: true }).every(i => i.durationSeconds <= 70)).toBe(true);
  });

  it.each(BENCHMARKS.filter(b => ['bench-threshold-3x10', 'bench-vo2-5x3', 'bench-easy-strides'].includes(b.id)))(
    'preserves reps, recoveries and strides for $name at different recording densities', benchmark => {
      let distance = 0;
      const all = benchmark.rows.map(row => {
        distance += row.spd;
        return { ...record(row.t, row.hr, row.spd, row.cad), distanceMeters: distance };
      });
      const expected = detectIntervals(all);
      for (const step of [5, 10, 15]) {
        // Preserve observed transitions and last points of each phase, as smart recording does.
        const sampled = all.filter((r, index) => index % step === 0 || index === all.length - 1 ||
          (index > 0 && (r.cadence !== all[index - 1].cadence || r.speedMps !== all[index - 1].speedMps)) ||
          (index + 1 < all.length && (r.cadence !== all[index + 1].cadence || r.speedMps !== all[index + 1].speedMps)));
        const intervals = detectIntervals(sampled);
        expect(intervals.map(i => i.type)).toEqual(expected.map(i => i.type));
        for (let i = 0; i < intervals.length; i++) {
          expect(intervals[i].durationSeconds).toBeCloseTo(expected[i].durationSeconds, 0);
          expect(Math.abs(intervals[i].avgHeartRate - expected[i].avgHeartRate)).toBeLessThanOrEqual(1);
          expect(intervals[i].avgPaceSecKm).toBe(expected[i].avgPaceSecKm);
        }
      }
    });
});
