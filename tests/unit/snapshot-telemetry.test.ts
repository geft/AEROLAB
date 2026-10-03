import { describe, expect, it } from 'vitest';
import { sampleSnapshotTelemetry } from '../../scripts/snapshot-telemetry.js';
import type { ActivityInterval, ActivityRecord } from '../../src/shared/contracts/activity-detail.js';

function records(duration = 180): ActivityRecord[] {
  return Array.from({ length: duration + 1 }, (_, time) => ({
    id: time, elapsed_seconds: time, distance_m: time * 3,
    speed_mps: 3, heart_rate: 140, cadence: 180, altitude_m: 12,
  }));
}

function interval(type: string, start: number, duration: number): ActivityInterval {
  return { type, interval_index: 0, start_seconds: start, duration_seconds: duration,
    distance_meters: duration * 3, avg_pace_sec_km: 333, avg_heart_rate: 140 };
}

describe('phone snapshot telemetry sampling', () => {
  it('samples steady running at 30 seconds and retains the original endpoints and values', () => {
    const source = records();
    const before = structuredClone(source);
    const sampled = sampleSnapshotTelemetry(source, []);
    expect(sampled.map(record => record.elapsed_seconds)).toEqual([0, 15, 45, 75, 105, 135, 165, 180]);
    expect(source).toEqual(before);
    expect(sampled.every(record => source.includes(record))).toBe(true);
  });

  it.each(['stride', 'work'])('preserves full %s detail and delayed heart-rate recovery across every run classification', type => {
    const source = records();
    const sampled = sampleSnapshotTelemetry(source, [interval(type, 60, 15)]);
    const protectedPoints = source.filter(record => record.elapsed_seconds >= 50 && record.elapsed_seconds <= 135);
    expect(protectedPoints.every(record => sampled.includes(record))).toBe(true);
    expect(sampled.length).toBeLessThan(source.length);
  });

  it('samples long work intervals while preserving their start and end transitions', () => {
    const source = records(700);
    const sampled = sampleSnapshotTelemetry(source, [interval('work', 60, 500)]);
    const boundaries = source.filter(record => (record.elapsed_seconds >= 55 && record.elapsed_seconds <= 65)
      || (record.elapsed_seconds >= 555 && record.elapsed_seconds <= 565));
    expect(boundaries.every(record => sampled.includes(record))).toBe(true);
    expect(sampled.length).toBeLessThan(70);
  });

  it('retains short stop transitions, telemetry gaps and chart extrema', () => {
    const source = records(240).map(record => ({ ...record,
      speed_mps: record.elapsed_seconds >= 100 && record.elapsed_seconds < 120 ? 0 : record.speed_mps,
    })).filter(record => record.elapsed_seconds <= 150 || record.elapsed_seconds >= 220);
    source.find(record => record.elapsed_seconds === 22)!.heart_rate = 180;
    source.find(record => record.elapsed_seconds === 23)!.altitude_m = 35;
    source.find(record => record.elapsed_seconds === 24)!.speed_mps = 5;
    const sampled = sampleSnapshotTelemetry(source, []);
    expect(sampled.map(record => record.elapsed_seconds)).toEqual(expect.arrayContaining([22, 23, 24, 99, 100, 119, 120, 150, 220]));
    expect(sampled.every((record, index) => index === 0 || record.elapsed_seconds >= sampled[index - 1].elapsed_seconds)).toBe(true);
  });

  it('preserves empty and tiny telemetry arrays', () => {
    expect(sampleSnapshotTelemetry([], [])).toEqual([]);
    const source = records(1);
    expect(sampleSnapshotTelemetry(source, [])).toEqual(source);
  });
});
