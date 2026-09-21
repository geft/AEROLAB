import { describe, it, expect } from 'vitest';
import { calculateEconomy, extractSteadyStateMetrics } from '../../src/backend/physiology/economy.js';
import { detectIntervals } from '../../src/backend/ingestion/interval-detector.js';
import { classifyRun } from '../../src/backend/ingestion/classifier.js';
import { ActivityRecord, ActivityMetadata } from '../../src/backend/ingestion/csv-parser.js';

describe('Physiological & Sensor Edge Cases Unit Tests', () => {
  const dummyMetadata: ActivityMetadata = {
    id: 'edge-case-act',
    name: 'Edge Case Run',
    date: '2026-09-15 07:00:00',
    sport: 'running',
    totalDistanceMeters: 5000,
    totalDurationSeconds: 1800,
    totalElapsedSeconds: 1800,
    avgHeartRate: 140,
    maxHeartRate: 160,
    avgCadence: 170,
    maxCadence: 180,
    calories: 400,
    totalAscentMeters: 5,
    totalDescentMeters: 5
  };

  function createRecord(i: number, overrides: Partial<ActivityRecord> = {}): ActivityRecord {
    return {
      timestamp: new Date(1789400000000 + i * 1000).toISOString(),
      elapsedSeconds: i,
      heartRate: 140,
      cadence: 172,
      speedMps: 3.0,
      distanceMeters: i * 3.0,
      altitudeMeters: 10,
      latitude: 1.35,
      longitude: 103.82,
      temperature: 28,
      verticalOscillation: 8.0,
      stanceTime: 240,
      ...overrides
    };
  }

  it('handles sensor dropouts with zero cadence without NaN or division by zero', () => {
    // 30 mins with sporadic cadence dropouts (zero cadence)
    const records: ActivityRecord[] = Array.from({ length: 1800 }, (_, i) => {
      const isDropout = i % 10 === 0;
      return createRecord(i, {
        cadence: isDropout ? 0 : 175,
        speedMps: 3.2
      });
    });

    const economy = calculateEconomy(records);
    expect(economy.efficiencyFactor).toBeGreaterThan(0);
    expect(Number.isNaN(economy.efficiencyFactor)).toBe(false);

    const steady = extractSteadyStateMetrics(records);
    expect(steady.steadyCadence).toBeGreaterThan(160);
    expect(Number.isNaN(steady.steadyCadence)).toBe(false);
  });

  it('handles treadmill runs with missing GPS coordinates and zero elevation', () => {
    const records: ActivityRecord[] = Array.from({ length: 1200 }, (_, i) => {
      return createRecord(i, {
        latitude: null,
        longitude: null,
        altitudeMeters: null,
        speedMps: 3.33
      });
    });

    const intervals = detectIntervals(records);
    expect(Array.isArray(intervals)).toBe(true);

    const economy = calculateEconomy(records);
    expect(economy.efficiencyFactor).toBeGreaterThan(0);
  });

  it('handles negative or extreme altitude changes smoothly without throwing', () => {
    const records: ActivityRecord[] = Array.from({ length: 900 }, (_, i) => {
      return createRecord(i, {
        altitudeMeters: -15 + Math.sin(i / 100) * 5 // below sea level
      });
    });

    const economy = calculateEconomy(records);
    expect(economy).toBeDefined();
    expect(economy.movingDurationSeconds).toBeGreaterThan(0);
  });

  it('classifies very short shakeout runs (< 15 mins) as recovery or easy base safely', () => {
    const shortMetadata: ActivityMetadata = {
      ...dummyMetadata,
      totalDistanceMeters: 1500,
      totalDurationSeconds: 600,
      totalElapsedSeconds: 600
    };
    const records: ActivityRecord[] = Array.from({ length: 600 }, (_, i) => {
      return createRecord(i, { heartRate: 125, cadence: 160, speedMps: 2.5 });
    });

    const economy = calculateEconomy(records);
    const classification = classifyRun(shortMetadata, records, economy, [], { lt1Hr: 145, lt2Hr: 168 });
    expect(['recovery', 'easy_base']).toContain(classification.runType);
    expect(classification.confidence).toBeGreaterThan(0);
  });

  it('detects intervals accurately when heart rate is flat or sensor is erratic', () => {
    const records: ActivityRecord[] = Array.from({ length: 1000 }, (_, i) => {
      // Cadence changes from warmup 160 to fast strides 195
      const isStride = i >= 300 && i <= 330;
      return createRecord(i, {
        cadence: isStride ? 195 : 162,
        speedMps: isStride ? 6.0 : 2.5,
        heartRate: 142 // Flat HR still permits strides when speed confirms the burst.
      });
    });

    const intervals = detectIntervals(records);
    const strideInt = intervals.find(int => int.type === 'stride' || int.avgCadence >= 190);
    expect(strideInt).toBeDefined();
  });
});
