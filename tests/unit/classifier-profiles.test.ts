import { describe, expect, it } from 'vitest';
import { classifyRun } from '../../src/backend/ingestion/classifier.js';
import { detectIntervals } from '../../src/backend/ingestion/interval-detector.js';
import { calculateEconomy } from '../../src/backend/physiology/economy.js';
import type { ActivityMetadata, ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';

// Independent synthetic scenarios, not rescaled copies of GJ's workouts.
// These test algorithm invariants, not real-world physiological accuracy.
const cases = [
  [160, 45], [180, 50], [195, 40], [210, 65], [220, 80], [165, 70]
].flatMap(([maxHr, restingHr]) => [0.78, 0.82, 0.88].flatMap(lt2Fraction =>
  [1, 5].flatMap(density => [0.7, 1.3].flatMap(speedFactor =>
    (['easy_base', 'threshold_lt2', 'intervals_vo2'] as const).map(expected => ({
      maxHr, restingHr, lt2Fraction, density, speedFactor, expected
    }))
  ))
));

describe('Classification across distinct athlete profiles and fitness states', () => {
  it.each(cases)('$expected: max $maxHr, rest $restingHr, LT2 reserve fraction $lt2Fraction, sampling $density, speed $speedFactor', test => {
    const { maxHr, restingHr, density, speedFactor, expected } = test;
    const reserve = maxHr - restingHr;
    const profile = {
      maxHr, restingHr, lt1Hr: Math.round(restingHr + reserve * 0.65),
      lt2Hr: Math.round(restingHr + reserve * test.lt2Fraction)
    };
    const records: ActivityRecord[] = [];
    let distance = 0;
    const append = (seconds: number, hr: number, cadence: number, speed: number) => {
      for (let sec = 0; sec < seconds; sec += density) {
        records.push({
          timestamp: '', elapsedSeconds: records.length * density, heartRate: hr,
          cadence, speedMps: speed * speedFactor, distanceMeters: distance,
          altitudeMeters: null, latitude: null, longitude: null, temperature: null,
          stanceTime: 240, verticalOscillation: 7
        });
        distance += speed * speedFactor * density;
      }
    };
    if (expected === 'easy_base') {
      append(3600, profile.lt1Hr - 10, 165, 2.5);
    } else {
      append(900, profile.lt1Hr - 15, 165, 2.3);
      for (let rep = 0; rep < 3; rep++) {
        append(expected === 'threshold_lt2' ? 600 : 480,
          expected === 'threshold_lt2' ? profile.lt2Hr : Math.round(restingHr + reserve * 0.96), 185, 3.8);
        append(180, profile.lt1Hr - 10, 100, 1.2);
      }
      append(300, profile.lt1Hr - 15, 165, 2.3);
    }
    const metadata: ActivityMetadata = {
      id: 'synthetic-profile', name: 'Running', sport: 'running', date: '2026-01-01',
      totalDistanceMeters: distance, totalDurationSeconds: records.length * density,
      totalElapsedSeconds: records.length * density,
      avgHeartRate: Math.round(records.reduce((sum, r) => sum + (r.heartRate ?? 0), 0) / records.length),
      maxHeartRate: Math.max(...records.map(r => r.heartRate ?? 0)), avgCadence: 165, maxCadence: 185,
      calories: 0, totalAscentMeters: 0, totalDescentMeters: 0
    };
    expect(classifyRun(metadata, records, calculateEconomy(records),
      detectIntervals(records, profile), profile).runType).toBe(expected);
  });

  it('changes threshold interpretation when LT2 changes while max HR and the recorded effort stay fixed', () => {
    const records: ActivityRecord[] = Array.from({ length: 2400 }, (_, elapsedSeconds) => ({
      timestamp: '', elapsedSeconds, heartRate: 155, cadence: 170, speedMps: 3,
      distanceMeters: elapsedSeconds * 3, altitudeMeters: null, latitude: null,
      longitude: null, temperature: null, stanceTime: 240, verticalOscillation: 7
    }));
    const metadata: ActivityMetadata = {
      id: 'threshold-shift', name: 'Running', sport: 'running', date: '2026-01-01',
      totalDistanceMeters: 7200, totalDurationSeconds: 2400, totalElapsedSeconds: 2400,
      avgHeartRate: 155, maxHeartRate: 155, avgCadence: 170, maxCadence: 170,
      calories: 0, totalAscentMeters: 0, totalDescentMeters: 0
    };
    const economy = calculateEconomy(records);
    expect(classifyRun(metadata, records, economy, [], { maxHr: 190, restingHr: 50, lt1Hr: 135, lt2Hr: 155 }).runType)
      .toBe('threshold_lt2');
    expect(classifyRun(metadata, records, economy, [], { maxHr: 190, restingHr: 50, lt1Hr: 145, lt2Hr: 170 }).runType)
      .toBe('easy_base');
  });
});
