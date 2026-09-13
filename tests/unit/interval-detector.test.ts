import { describe, it, expect } from 'vitest';
import { detectIntervals } from '../../src/backend/ingestion/interval-detector';
import { ActivityRecord } from '../../src/backend/ingestion/csv-parser';

describe('Interval & Stride Detector (Unit)', () => {
  function makeRecord(sec: number, cad: number, spd: number, hr: number, stance = 240): ActivityRecord {
    return {
      timestamp: `2026-09-11T20:${Math.floor(sec / 60)}:${sec % 60}Z`,
      elapsedSeconds: sec,
      heartRate: hr,
      cadence: cad,
      speedMps: spd,
      distanceMeters: sec * spd,
      altitudeMeters: 10,
      latitude: null,
      longitude: null,
      temperature: 28,
      verticalOscillation: 7.0,
      stanceTime: stance
    };
  }

  it('returns empty array if records < 60', () => {
    const records = Array.from({ length: 30 }, (_, i) => makeRecord(i, 170, 3.5, 150));
    expect(detectIntervals(records)).toEqual([]);
  });

  it('returns empty array for a steady run with zero rest breaks (only 1 continuous work block)', () => {
    // 300 seconds of uninterrupted running
    const records = Array.from({ length: 300 }, (_, i) => makeRecord(i, 168, 3.2, 138));
    expect(detectIntervals(records)).toEqual([]);
  });

  it('detects structured intervals: work -> recovery -> work', () => {
    const records: ActivityRecord[] = [];
    let sec = 0;

    // Rep 1: 60s hard interval (175 spm, 4.0 m/s, HR 150->165)
    for (let i = 0; i < 60; i++, sec++) {
      records.push(makeRecord(sec, 175, 4.0, 150 + Math.floor(i * 0.25), 210));
    }
    // Rest 1: 40s recovery walk (90 spm, 1.0 m/s, HR 165->130)
    for (let i = 0; i < 40; i++, sec++) {
      records.push(makeRecord(sec, 90, 1.0, 165 - Math.floor(i * 0.8), 350));
    }
    // Rep 2: 60s hard interval (178 spm, 4.2 m/s, HR 140->170)
    for (let i = 0; i < 60; i++, sec++) {
      records.push(makeRecord(sec, 178, 4.2, 140 + Math.floor(i * 0.5), 205));
    }

    const intervals = detectIntervals(records);
    expect(intervals.length).toBeGreaterThanOrEqual(3);

    const workReps = intervals.filter(i => i.type === 'work');
    const recoveries = intervals.filter(i => i.type === 'recovery');

    expect(workReps.length).toBe(2);
    expect(recoveries.length).toBe(1);

    // HR drop during recovery
    expect(recoveries[0].hrDrop).toBeGreaterThan(15);
    // Work rep dynamics
    expect(workReps[0].avgCadence).toBeGreaterThan(170);
    expect(workReps[0].minStanceTime).toBeLessThanOrEqual(210);
  });

  it('classifies short high-velocity bursts (<=45s, speed >= 3.4 m/s) as strides', () => {
    const records: ActivityRecord[] = [];
    let sec = 0;

    // Base jog: 60s
    for (let i = 0; i < 60; i++, sec++) {
      records.push(makeRecord(sec, 160, 2.8, 130));
    }
    // Rest: 20s
    for (let i = 0; i < 20; i++, sec++) {
      records.push(makeRecord(sec, 80, 0.8, 120));
    }
    // Stride 1: 25s explosive acceleration (195 spm, 5.2 m/s, min stance 185ms)
    for (let i = 0; i < 25; i++, sec++) {
      records.push(makeRecord(sec, 195, 5.2, 155, 185));
    }
    // Rest: 30s
    for (let i = 0; i < 30; i++, sec++) {
      records.push(makeRecord(sec, 80, 0.8, 130));
    }
    // Stride 2: 25s explosive acceleration (198 spm, 5.4 m/s, min stance 180ms)
    for (let i = 0; i < 25; i++, sec++) {
      records.push(makeRecord(sec, 198, 5.4, 160, 180));
    }

    const intervals = detectIntervals(records);
    const strides = intervals.filter(i => i.type === 'stride');

    expect(strides.length).toBe(2);
    expect(strides[0].peakCadence).toBeGreaterThanOrEqual(195);
    expect(strides[0].peakSpeedMps).toBeGreaterThanOrEqual(5.0);
    expect(strides[0].minStanceTime).toBeLessThanOrEqual(185);
  });
});
