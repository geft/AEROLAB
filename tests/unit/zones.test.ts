import { describe, it, expect } from 'vitest';
import { getDefaultZones, calculateZoneDistribution } from '../../src/backend/physiology/zones.js';
import { ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';

describe('Heart Rate Zones & Distribution Unit Tests', () => {
  it('calculates default zones based on max HR', () => {
    const zones = getDefaultZones(185);
    expect(zones.z1).toEqual([0, 127]);
    expect(zones.z2).toEqual([128, 141]);
    expect(zones.z3).toEqual([142, 160]);
    expect(zones.z4).toEqual([161, 172]);
    expect(zones.z5[0]).toBe(173);
  });

  it('respects custom LT1 and LT2 values without special-case athlete branches', () => {
    const zones = getDefaultZones(190, 144, 170, 60);
    expect(zones.z1[1]).toBe(130);
    expect(zones.z2[1]).toBe(144);
    expect(zones.z3).toEqual([145, 164]);
    expect(zones.z4).toEqual([165, 176]);
    expect(zones.z5[0]).toBe(177);
  });

  it('keeps LT2 in upper Zone 4 and reserves Zone 5 for high-intensity HR', () => {
    const zones = getDefaultZones(203, 153, 179, 54);

    expect(zones.z4[1]).toBe(187);
    expect(zones.z5[0]).toBe(188);
    expect(zones.z4[1]).toBeGreaterThan(179);
  });

  it('does not classify a threshold workout as Zone 5 just for crossing LT2', () => {
    const zones = getDefaultZones(203, 153, 179, 54);
    const records = [179, 180, 181, 182, 183, 187, 188].map((heartRate, index) => ({
      timestamp: '2026-09-24 19:30:00', elapsedSeconds: index, heartRate,
      speedMps: 3, cadence: 175, fractionalCadence: 0, altitudeMeters: 0,
      distanceMeters: index * 3, temperature: 28, stanceTime: 240,
      verticalOscillation: 80, latitude: 1.35, longitude: 103.85
    })) as ActivityRecord[];
    const distribution = calculateZoneDistribution(records, zones);

    expect(distribution.z4Seconds).toBe(6);
    expect(distribution.z5Seconds).toBe(1);
  });

  it('calculates accurate zone distribution and percentages across records', () => {
    const zones = getDefaultZones(185); // HRR-derived zones with provisional resting HR

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
          altitudeMeters: 10,
          distanceMeters: records.length * 3,
          temperature: 28,
          stanceTime: 240,
          verticalOscillation: 80,
          latitude: 1.35,
          longitude: 103.85
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

  it('weights variable-rate recordings by elapsed seconds and ignores unobserved gaps', () => {
    const zones = getDefaultZones(185);
    const records = [
      { elapsedSeconds: 0, heartRate: 120 },
      { elapsedSeconds: 10, heartRate: 175 },
      { elapsedSeconds: 11, heartRate: 175 },
      { elapsedSeconds: 12, heartRate: 175 },
      { elapsedSeconds: 100, heartRate: 135 },
      { elapsedSeconds: 110, heartRate: 135 }
    ] as ActivityRecord[];
    const result = calculateZoneDistribution(records, zones);
    expect(result.z1Seconds).toBe(10);
    expect(result.z2Seconds).toBe(20);
    expect(result.z5Seconds).toBe(2);
    expect(result.z5Pct).toBe(6.3);
  });
});
