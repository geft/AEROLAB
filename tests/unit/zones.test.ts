import { describe, it, expect } from 'vitest';
import { getDefaultZones, calculateZoneDistribution } from '../../src/backend/physiology/zones.js';
import { ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';

describe('Heart Rate Zones & Distribution Unit Tests', () => {
  it('calculates default zones based on max HR', () => {
    const zones = getDefaultZones(185);
    // LT1 = round(185 * 0.76) = 141
    // LT2 = round(185 * 0.88) = 163
    // z1: [0, 129]
    // z2: [129, 141]
    // z3: [142, 157]
    // z4: [158, 166]
    // z5: [167, 250]
    expect(zones.z1[1]).toBe(129);
    expect(zones.z2[0]).toBe(129);
    expect(zones.z2[1]).toBe(141);
    expect(zones.z3[0]).toBe(142);
    expect(zones.z3[1]).toBe(157);
    expect(zones.z4[0]).toBe(158);
    expect(zones.z4[1]).toBe(166);
    expect(zones.z5[0]).toBe(167);
  });

  it('respects custom LT1 and LT2 values', () => {
    const zones = getDefaultZones(190, 144, 170);
    expect(zones.z1[1]).toBe(132); // 144 - 12
    expect(zones.z2[1]).toBe(144);
    expect(zones.z3[0]).toBe(145);
    expect(zones.z3[1]).toBe(164); // 170 - 6
    expect(zones.z4[0]).toBe(165); // 170 - 5
    expect(zones.z4[1]).toBe(173); // 170 + 3
    expect(zones.z5[0]).toBe(174);
  });

  it('calculates accurate zone distribution and percentages across records', () => {
    const zones = getDefaultZones(185); // z1 <= 129, z2 <= 141, z3 <= 157, z4 <= 166, z5 > 166

    // Create 100 sample records
    const records: ActivityRecord[] = [];
    const addRecords = (hr: number, count: number) => {
      for (let i = 0; i < count; i++) {
        records.push({
          timestamp: '2026-09-12 07:00:00',
          elapsedSeconds: records.length,
          heartRate: hr,
          speedMps: 3.0,
          cadence: 175,
          fractionalCadence: 0,
          altitudeM: 10,
          distanceMeters: records.length * 3,
          temperatureC: 28,
          stanceTimeMs: 240,
          verticalOscillationMm: 80,
          lat: 1.35,
          lon: 103.85
        });
      }
    };

    addRecords(120, 10); // Z1 (10)
    addRecords(135, 60); // Z2 (60)
    addRecords(148, 15); // Z3 (15)
    addRecords(162, 10); // Z4 (10)
    addRecords(175, 5);  // Z5 (5)
    addRecords(30, 5);   // <= 40 (ignored)
    addRecords(0, 2);    // 0 / null (ignored)

    const dist = calculateZoneDistribution(records, zones);
    expect(dist.z1Seconds).toBe(10);
    expect(dist.z2Seconds).toBe(60);
    expect(dist.z3Seconds).toBe(15);
    expect(dist.z4Seconds).toBe(10);
    expect(dist.z5Seconds).toBe(5);

    // Total valid = 100
    expect(dist.z1Pct).toBe(10.0);
    expect(dist.z2Pct).toBe(60.0);
    expect(dist.z3Pct).toBe(15.0);
    expect(dist.z4Pct).toBe(10.0);
    expect(dist.z5Pct).toBe(5.0);
  });

  it('returns zero percentages safely when records list is empty', () => {
    const zones = getDefaultZones();
    const dist = calculateZoneDistribution([], zones);
    expect(dist.z1Seconds).toBe(0);
    expect(dist.z1Pct).toBe(0);
    expect(dist.z2Pct).toBe(0);
    expect(dist.z3Pct).toBe(0);
    expect(dist.z4Pct).toBe(0);
    expect(dist.z5Pct).toBe(0);
  });
});
