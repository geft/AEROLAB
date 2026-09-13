import { describe, it, expect } from 'vitest';
import { classifyRun } from '../../src/backend/ingestion/classifier';
import { ActivityMetadata, ActivityRecord } from '../../src/backend/ingestion/csv-parser';
import { EconomyMetrics } from '../../src/backend/physiology/economy';
import { DetectedInterval } from '../../src/backend/ingestion/interval-detector';

describe('Run Classifier Engine (Unit)', () => {
  const baseMetadata: ActivityMetadata = {
    id: '123456',
    name: 'Singapore Run',
    sport: 'running',
    date: '2026-09-11 19:50:00',
    totalDistanceMeters: 8000,
    totalDurationSeconds: 2400, // 40 min
    totalElapsedSeconds: 2450,
    avgHeartRate: 135,
    maxHeartRate: 180,
    avgCadence: 165,
    maxCadence: 175,
    calories: 450,
    totalAscentMeters: 10,
    totalDescentMeters: 10
  };

  const baseEconomy: EconomyMetrics = {
    efficiencyFactor: 1.15,
    aerobicDecouplingPct: 2.1,
    metersPerBeat: 360,
    firstHalfEf: 1.16,
    secondHalfEf: 1.14
  };

  function createMockRecords(durationSec: number, hr: number): ActivityRecord[] {
    return Array.from({ length: durationSec }, (_, i) => ({
      timestamp: `2026-09-11T19:${Math.floor(i / 60)}:${i % 60}Z`,
      elapsedSeconds: i,
      heartRate: hr,
      cadence: 165,
      speedMps: 3.3,
      distanceMeters: i * 3.3,
      altitudeMeters: 10,
      latitude: null,
      longitude: null,
      temperature: 28,
      verticalOscillation: 7.0,
      stanceTime: 240
    }));
  }

  it('classifies as intervals_vo2 when 2+ work reps are detected', () => {
    const intervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 100, durationSeconds: 60, distanceMeters: 300, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 165, maxHeartRate: 172, avgCadence: 180 },
      { intervalIndex: 2, type: 'recovery', startSeconds: 160, durationSeconds: 60, distanceMeters: 100, avgSpeedMps: 1.6, avgPaceSecKm: 600, avgHeartRate: 140, maxHeartRate: 165, avgCadence: 110 },
      { intervalIndex: 3, type: 'work', startSeconds: 220, durationSeconds: 60, distanceMeters: 300, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 168, maxHeartRate: 175, avgCadence: 182 }
    ];

    const records = createMockRecords(600, 150);
    const result = classifyRun(baseMetadata, records, baseEconomy, intervals);
    expect(result.runType).toBe('intervals_vo2');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('classifies as long_run when duration >= 75 minutes or distance >= 16 km', () => {
    const meta: ActivityMetadata = {
      ...baseMetadata,
      totalDurationSeconds: 4800, // 80 min
      totalDistanceMeters: 15000 // 15 km
    };
    const records = createMockRecords(4800, 138);
    const result = classifyRun(meta, records, baseEconomy, []);
    expect(result.runType).toBe('long_run');
  });

  it('classifies as threshold_lt2 when significant time is spent in Zone 4', () => {
    const meta: ActivityMetadata = {
      ...baseMetadata,
      avgHeartRate: 168,
      maxHeartRate: 185
    };
    // 168 bpm on 185 max HR is solidly in Zone 4 (88%-92%)
    const records = createMockRecords(2400, 168);
    const result = classifyRun(meta, records, baseEconomy, []);
    expect(result.runType).toBe('threshold_lt2');
  });

  it('classifies as recovery when short duration (<=35 min) and low HR (<70% max HR)', () => {
    const meta: ActivityMetadata = {
      ...baseMetadata,
      totalDurationSeconds: 1500, // 25 min
      totalDistanceMeters: 4000,
      avgHeartRate: 120,
      maxHeartRate: 185
    };
    const records = createMockRecords(1500, 120);
    const result = classifyRun(meta, records, baseEconomy, []);
    expect(result.runType).toBe('recovery');
  });

  it('defaults to easy_base for standard aerobic running', () => {
    // HR 145 is above the recovery ceiling (136 bpm / 72% of 180 = 129 bpm), so should not be classified as recovery
    const meta: ActivityMetadata = { ...baseMetadata, avgHeartRate: 145 };
    const records = createMockRecords(2400, 145);
    const result = classifyRun(meta, records, baseEconomy, []);
    expect(result.runType).toBe('easy_base');
  });
});
