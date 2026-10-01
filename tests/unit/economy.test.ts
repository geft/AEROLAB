import { describe, it, expect } from 'vitest';
import { calculateEconomy } from '../../src/backend/physiology/economy';
import { ActivityRecord } from '../../src/backend/ingestion/csv-parser';

describe('Running Economy Physiology', () => {
  it('calculates efficiency factor (speed/HR) and decoupling', () => {
    // Generate 60 seconds of synthetic run data
    const records: ActivityRecord[] = [];
    for (let i = 0; i < 60; i++) {
      records.push({
        timestamp: new Date(1700000000000 + i * 1000).toISOString(),
        elapsedSeconds: i,
        heartRate: 140, // 140 bpm
        cadence: 180,
        speedMps: 3.0, // 3 m/s = 180 m/min -> EF = 180 / 140 = 1.2857
        distanceMeters: i * 3.0,
        altitudeMeters: 10,
        latitude: 1.35,
        longitude: 103.85,
        temperature: 28,
        verticalOscillation: 80,
        stanceTime: 240
      });
    }

    const result = calculateEconomy(records);
    expect(result.efficiencyFactor).toBeCloseTo(1.2857, 3);
    expect(result.aerobicDecouplingPct).toBeCloseTo(0, 1); // constant speed & HR = 0% drift
    expect(result.metersPerBeat).toBeGreaterThan(1.0);
  });

  it('filters out stops and pauses from moving metrics', () => {
    const records: ActivityRecord[] = [
      // 10s moving
      ...Array.from({ length: 15 }, (_, i) => ({
        timestamp: new Date(1700000000000 + i * 1000).toISOString(),
        elapsedSeconds: i,
        heartRate: 140,
        cadence: 175,
        speedMps: 2.8,
        distanceMeters: i * 2.8,
        altitudeMeters: 10,
        latitude: 1.35,
        longitude: 103.85,
        temperature: 28,
        verticalOscillation: 80,
        stanceTime: 240
      })),
      // 10s stopped at traffic light
      ...Array.from({ length: 10 }, (_, i) => ({
        timestamp: new Date(1700000015000 + i * 1000).toISOString(),
        elapsedSeconds: 15 + i,
        heartRate: 110,
        cadence: 0,
        speedMps: 0,
        distanceMeters: 42,
        altitudeMeters: 10,
        latitude: 1.35,
        longitude: 103.85,
        temperature: 28,
        verticalOscillation: null,
        stanceTime: null
      }))
    ];

    const result = calculateEconomy(records);
    // The first sample has no preceding observed interval.
    expect(result.movingDurationSeconds).toBe(14);
  });

  it('isolates stops and walk breaks from steady state running via extractSteadyStateMetrics', () => {
    // 30s steady running (cadence 175, speed 2.8 m/s, HR 140, GCT 250)
    // 10s traffic light stop (cadence 0, speed 0 m/s, HR 105)
    // 15s walk break (cadence 110, speed 1.2 m/s, HR 120, GCT 390)
    // 30s steady running (cadence 177, speed 2.9 m/s, HR 142, GCT 245)
    const records: ActivityRecord[] = [];
    let sec = 0;
    let dist = 0;

    // Run 1: 30s
    for (let i = 0; i < 30; i++) {
      dist += 2.8;
      records.push({
        timestamp: new Date(1700000000000 + sec * 1000).toISOString(),
        elapsedSeconds: sec++,
        heartRate: 140,
        cadence: 175,
        speedMps: 2.8,
        distanceMeters: dist,
        altitudeMeters: 10,
        latitude: 1.35,
        longitude: 103.85,
        temperature: 28,
        verticalOscillation: 82,
        stanceTime: 250
      });
    }

    // Stop: 10s
    for (let i = 0; i < 10; i++) {
      records.push({
        timestamp: new Date(1700000000000 + sec * 1000).toISOString(),
        elapsedSeconds: sec++,
        heartRate: 105,
        cadence: 0,
        speedMps: 0,
        distanceMeters: dist,
        altitudeMeters: 10,
        latitude: 1.35,
        longitude: 103.85,
        temperature: 28,
        verticalOscillation: null,
        stanceTime: null
      });
    }

    // Walk: 15s
    for (let i = 0; i < 15; i++) {
      dist += 1.2;
      records.push({
        timestamp: new Date(1700000000000 + sec * 1000).toISOString(),
        elapsedSeconds: sec++,
        heartRate: 120,
        cadence: 110,
        speedMps: 1.2,
        distanceMeters: dist,
        altitudeMeters: 10,
        latitude: 1.35,
        longitude: 103.85,
        temperature: 28,
        verticalOscillation: 50,
        stanceTime: 390
      });
    }

    // Run 2: 30s
    for (let i = 0; i < 30; i++) {
      dist += 2.9;
      records.push({
        timestamp: new Date(1700000000000 + sec * 1000).toISOString(),
        elapsedSeconds: sec++,
        heartRate: 142,
        cadence: 177,
        speedMps: 2.9,
        distanceMeters: dist,
        altitudeMeters: 10,
        latitude: 1.35,
        longitude: 103.85,
        temperature: 28,
        verticalOscillation: 80,
        stanceTime: 245
      });
    }

    const economy = calculateEconomy(records);
    expect(economy.pauseBreakdown).toBeDefined();
    const pb = economy.pauseBreakdown!;

    // Verify stop detection
    expect(pb.stopCount).toBe(1);
    expect(pb.stopDurationSeconds).toBe(10);

    // Verify walk break detection
    expect(pb.walkCount).toBe(1);
    expect(pb.walkDurationSeconds).toBe(15);
    expect(pb.walkDistanceMeters).toBeCloseTo(18, 0);

    // Verify steady running isolation
    expect(pb.steadyRunningDurationSeconds).toBe(59);
    expect(pb.steadyCadence).toBe(176); // (175*30 + 177*30) / 60 = 176
    expect(pb.steadyHeartRate).toBe(141); // (140*30 + 142*30) / 60 = 141
    expect(pb.steadyStanceTimeMs).toBeCloseTo(247.5, 1);
  });

  it('preserves slow running when cadence is in running range (cadence >= 135) without misclassifying as walk breaks', () => {
    // 40s of slow uphill jog: speed 1.3 m/s (7:41/km pace), but cadence is 165 spm (running mechanics)
    // 15s of walk break: speed 1.2 m/s, cadence 112 spm
    const records: ActivityRecord[] = [];
    let sec = 0;
    let dist = 0;

    // Slow running (speed 1.3 m/s, cadence 165)
    for (let i = 0; i < 40; i++) {
      dist += 1.3;
      records.push({
        timestamp: new Date(1700000000000 + sec * 1000).toISOString(),
        elapsedSeconds: sec++,
        heartRate: 130,
        cadence: 165,
        speedMps: 1.3,
        distanceMeters: dist,
        altitudeMeters: 25,
        latitude: 1.35,
        longitude: 103.85,
        temperature: 28,
        verticalOscillation: 70,
        stanceTime: 290
      });
    }

    // Walk break (speed 1.2 m/s, cadence 112)
    for (let i = 0; i < 15; i++) {
      dist += 1.2;
      records.push({
        timestamp: new Date(1700000000000 + sec * 1000).toISOString(),
        elapsedSeconds: sec++,
        heartRate: 115,
        cadence: 112,
        speedMps: 1.2,
        distanceMeters: dist,
        altitudeMeters: 25,
        latitude: 1.35,
        longitude: 103.85,
        temperature: 28,
        verticalOscillation: 45,
        stanceTime: 380
      });
    }

    const economy = calculateEconomy(records);
    const pb = economy.pauseBreakdown!;

    // Slow running must NOT be counted as a walk break
    expect(pb.walkCount).toBe(1);
    expect(pb.walkDurationSeconds).toBe(15);
    expect(pb.stopCount).toBe(0);

    // Steady running should include all 40s of slow running
    expect(pb.steadyRunningDurationSeconds).toBe(39);
    expect(pb.steadyCadence).toBe(165);
    expect(pb.steadyHeartRate).toBe(130);
  });

  it('correctly calculates economy under Garmin Smart Recording (sample gaps 5-10s) without artificial pace compression', () => {
    // 30 minutes of continuous running at 2.5 m/s (6:40/km) and 140 bpm, recorded via Smart Recording every 6-8s
    const records: ActivityRecord[] = [];
    let elapsed = 0;
    let dist = 0;
    const speed = 2.5; // 2.5 m/s = 150 m/min -> EF = 150 / 140 = 1.0714

    while (elapsed < 1800) {
      records.push({
        timestamp: new Date(1700000000000 + elapsed * 1000).toISOString(),
        elapsedSeconds: elapsed,
        heartRate: 140,
        cadence: 172,
        speedMps: speed,
        distanceMeters: dist,
        altitudeMeters: 15,
        latitude: 1.35,
        longitude: 103.85,
        temperature: 29,
        verticalOscillation: 78,
        stanceTime: 255
      });
      const step = 6 + (elapsed % 3); // 6, 7, or 8 second steps
      elapsed += step;
      dist += speed * step;
    }

    const economy = calculateEconomy(records);
    // Moving duration should approximate 1800s, not be collapsed to ~250s
    expect(economy.movingDurationSeconds).toBeGreaterThanOrEqual(1750);
    expect(economy.movingDurationSeconds).toBeLessThanOrEqual(1850);
    // EF should be ~1.07, not inflated to 3.0+
    expect(economy.efficiencyFactor).toBeCloseTo(1.0714, 1);
    expect(economy.metersPerBeat).toBeCloseTo(1.071, 1);
    // Pace should be ~400 sec/km (6:40/km)
    expect(economy.avgMovingPaceSecKm).toBeCloseTo(400, -1);
  });
});
