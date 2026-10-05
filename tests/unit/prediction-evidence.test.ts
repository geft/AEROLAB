import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateRacePredictions, type RaceBenchmark } from '../../src/backend/physiology/predictions.js';
import { getThresholdsService } from '../../src/backend/services/thresholds-service.js';
import { getDatabase } from '../../src/backend/db/client.js';
import { seedBenchmarkProfile } from '../fixtures/benchmark-runs.js';

const asOf = new Date('2026-10-01T12:00:00');
const benchmark = (date: string | null): RaceBenchmark => ({ paceSecKm: 240, date, source: date ? 'race_segment' : 'profile_pb' });

describe('Prediction evidence freshness and provenance', () => {
  afterEach(() => vi.useRealTimers());

  it.each([null, '2025-10-01', '2026-10-02', 'invalid'])('does not let stale, future or undated evidence override LT2: %s', date => {
    const expected = calculateRacePredictions(300, 360, null);
    const actual = calculateRacePredictions(300, 360, null, benchmark(date), { asOf, lt2EffectiveDate: '2026-09-15' });
    expect(actual.predictions).toEqual(expected.predictions);
    expect(actual.evidence).toMatchObject({ source: 'lt2', benchmarkUsed: false });
  });

  it('requires a fresh benchmark to be as recent as the calibrated threshold', () => {
    const old = calculateRacePredictions(300, null, null, benchmark('2026-09-01'), { asOf, lt2EffectiveDate: '2026-09-15' });
    expect(old.evidence.benchmarkUsed).toBe(false);
    const fresh = calculateRacePredictions(300, null, null, benchmark('2026-09-20'), { asOf, lt2EffectiveDate: '2026-09-15' });
    expect(fresh.evidence).toMatchObject({ source: 'benchmark_5k', benchmarkUsed: true, thresholdPaceSecKm: 253 });
    expect(fresh.predictions[0].paceSecKm).toBe(240);
  });

  it('permits an undated PB only as estimated evidence and ignores non-finite paces', () => {
    expect(calculateRacePredictions(null, 360, null, benchmark(null), { asOf }).evidence.source).toBe('benchmark_5k');
    expect(calculateRacePredictions(NaN, Infinity, -1, NaN).predictions).toEqual([]);
    expect(calculateRacePredictions(null, null, null, benchmark('2025-10-01'), { asOf }).predictions).toEqual([]);
    expect(calculateRacePredictions(320, null, null, null,
      { lt2IsEstimated: true, lt2EstimateSource: 'recent_runs' }).evidence.source).toBe('recent_runs');
  });

  it('selects current-day local and offset timestamps consistently without accepting future runs', () => {
    vi.useFakeTimers(); vi.setSystemTime(asOf);
    const db = getDatabase(':memory:');
    try {
      const insert = db.prepare(`INSERT INTO activities (id, name, start_time, run_type, distance_meters, duration_seconds, avg_pace_sec_km)
        VALUES (?, 'Trial', ?, 'race', 5000, 1200, 240)`);
      insert.run('local', '2026-10-01 11:00:00');
      insert.run('future-today', '2026-10-01 13:00:00');
      expect(getThresholdsService(db).predictionEvidence?.benchmark?.activityId).toBe('local');
      insert.run('offset', new Date('2026-10-01T11:30:00').toISOString());
      expect(getThresholdsService(db).predictionEvidence?.benchmark?.activityId).toBe('offset');
    } finally { db.close(); }
  });

  it('retrieves a recent race segment with its source and excludes stale/future activities from fallback', () => {
    vi.useFakeTimers(); vi.setSystemTime(asOf);
    const db = getDatabase(':memory:');
    try {
      seedBenchmarkProfile(db);
      const insert = db.prepare(`INSERT INTO activities
        (id, name, start_time, run_type, distance_meters, duration_seconds, avg_pace_sec_km)
        VALUES (?, ?, ?, 'race', ?, ?, ?)`);
      insert.run('stale', 'Old 5K', '2025-10-01', 5000, 1000, 200);
      insert.run('future', 'Future 5K', '2026-10-02', 5000, 900, 180);
      expect(getThresholdsService(db).predictions).toEqual([]);
      // A race with warm-up/cool-down must use its work segment rather than the activity average.
      insert.run('recent', 'Recent trial', '2026-09-20', 8000, 2700, 337.5);
      db.prepare(`INSERT INTO activity_intervals
        (activity_id, interval_index, type, start_seconds, duration_seconds, distance_meters, avg_pace_sec_km)
        VALUES ('recent', 1, 'work', 600, 1200, 5000, 240)`).run();
      const actual = getThresholdsService(db);
      expect(actual.predictionEvidence).toMatchObject({ source: 'benchmark_5k', benchmarkUsed: true,
        benchmark: { activityId: 'recent', date: '2026-09-20', source: 'race_segment', paceSecKm: 240 } });
      expect(actual.predictions[0].paceSecKm).toBe(240);
      db.prepare(`INSERT INTO physiological_thresholds (effective_date, source_kind, lt2_hr, lt2_pace_sec_km, confidence)
        VALUES ('2026-09-25', 'external', 167, 300, 0.9)`).run();
      const newerLt2 = getThresholdsService(db);
      expect(newerLt2.predictionEvidence?.source).toBe('lt2');
      expect(newerLt2.predictions[0].paceSecKm).toBe(284);
    } finally { db.close(); }
  });

  it('preserves a 21:23 trial despite GPS distance and integer pace rounding', () => {
    vi.useFakeTimers(); vi.setSystemTime(asOf);
    const db = getDatabase(':memory:');
    try {
      db.prepare(`INSERT INTO activities (id, name, start_time, run_type, distance_meters, duration_seconds, avg_pace_sec_km)
        VALUES ('trial', 'Running', '2026-10-01 11:00:00', 'race', 10163.69, 3580, 352)`).run();
      db.prepare(`INSERT INTO activity_intervals
        (activity_id, interval_index, type, start_seconds, duration_seconds, distance_meters, avg_pace_sec_km)
        VALUES ('trial', 8, 'work', 2290, 1283, 4989.2, 258)`).run();
      db.prepare(`INSERT INTO physiological_thresholds (effective_date, source_kind, lt2_hr, lt2_pace_sec_km, confidence)
        VALUES ('2026-09-24', 'external', 181, 274, 0.9)`).run();
      const result = getThresholdsService(db);
      expect(result.predictionEvidence?.benchmark?.paceSecKm).toBe(256.6);
      expect(result.predictions[0]).toMatchObject({ timeSeconds: 1283, timeFormatted: '21:23', paceFormatted: '4:17/km' });
    } finally { db.close(); }
  });
});
