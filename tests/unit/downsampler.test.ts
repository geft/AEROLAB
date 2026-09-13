import { describe, it, expect } from 'vitest';
import { downsampleRecords } from '../../src/backend/ingestion/downsampler';
import { ActivityRecord } from '../../src/backend/ingestion/csv-parser';
import { DetectedInterval } from '../../src/backend/ingestion/interval-detector';

describe('Downsampler Engine (Unit)', () => {
  function makeMockRecord(sec: number, overrides: Partial<ActivityRecord> = {}): ActivityRecord {
    return {
      timestamp: `2026-09-11T19:${Math.floor(sec / 60)}:${sec % 60}Z`,
      elapsedSeconds: sec,
      heartRate: 135,
      cadence: 160,
      speedMps: 3.0,
      distanceMeters: sec * 3.0,
      altitudeMeters: 15.5,
      latitude: 1.345678,
      longitude: 103.856789,
      temperature: 30.0,
      verticalOscillation: 7.2,
      stanceTime: 250,
      ...overrides
    };
  }

  it('returns original records if total count is <= 60', () => {
    const records: ActivityRecord[] = Array.from({ length: 40 }, (_, i) => makeMockRecord(i));
    const result = downsampleRecords(records);
    expect(result.length).toBe(40);
  });

  it('downsamples steady-state records to ~5 second intervals and strips GPS', () => {
    // 300 seconds of steady base running at 1Hz
    const records: ActivityRecord[] = Array.from({ length: 300 }, (_, i) => makeMockRecord(i));
    const result = downsampleRecords(records);

    // 300 seconds downsampled to ~5s steps: approx 61 records
    expect(result.length).toBeLessThan(70);
    expect(result.length).toBeGreaterThan(50);

    // Ensures first and last are preserved
    expect(result[0].elapsedSeconds).toBe(0);
    expect(result[result.length - 1].elapsedSeconds).toBe(299);

    // Strips GPS lat/lon to save storage footprint
    expect(result[0].latitude).toBeNull();
    expect(result[0].longitude).toBeNull();

    // Retains elevation and physiological metrics
    expect(result[0].altitudeMeters).toBe(15.5);
    expect(result[0].heartRate).toBe(135);
  });

  it('preserves high frequency (1-2s) during detected strides or interval reps', () => {
    // 120 seconds of running, with a stride from second 40 to 65
    const records: ActivityRecord[] = Array.from({ length: 120 }, (_, i) => makeMockRecord(i));
    const intervals: DetectedInterval[] = [
      {
        intervalIndex: 1,
        type: 'stride',
        startSeconds: 40,
        durationSeconds: 25,
        distanceMeters: 125,
        avgSpeedMps: 5.0,
        avgPaceSecKm: 200,
        avgHeartRate: 160,
        maxHeartRate: 168,
        avgCadence: 195,
        peakCadence: 202,
        peakSpeedMps: 5.5,
        peakPaceSecKm: 182,
        minStanceTime: 188
      }
    ];

    const result = downsampleRecords(records, intervals);
    const strideRecords = result.filter(r => r.elapsedSeconds >= 40 && r.elapsedSeconds <= 65);

    // In a 25s window at ~2s resolution, we expect around 12-14 records
    expect(strideRecords.length).toBeGreaterThanOrEqual(12);
  });

  it('preserves high frequency (1s) during sudden cadence surges (>185 spm)', () => {
    const records: ActivityRecord[] = Array.from({ length: 100 }, (_, i) => {
      // Sudden burst at seconds 50-55
      const isSurge = i >= 50 && i <= 55;
      return makeMockRecord(i, { cadence: isSurge ? 190 : 160, speedMps: isSurge ? 4.2 : 2.8 });
    });

    const result = downsampleRecords(records);
    const surgeRecords = result.filter(r => r.elapsedSeconds >= 50 && r.elapsedSeconds <= 55);

    // All 6 seconds of the surge should be preserved
    expect(surgeRecords.length).toBe(6);
  });
});
