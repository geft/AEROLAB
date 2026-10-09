import { describe, expect, it } from 'vitest';
import { isTreadmillFitMetadata } from '../../src/shared/activity-environment.js';
import { calculateKmSplits } from '../../src/backend/physiology/economy.js';
import { buildCoachContext } from '../../src/backend/physiology/coach-history.js';
import { workoutTrace } from '../fixtures/workout-trace.js';

describe('Treadmill metric boundaries', () => {
  it('recognizes source metadata without inferring indoor status from missing GPS', () => {
    expect(isTreadmillFitMetadata({ session: { sub_sport: 'treadmill' } })).toBe(true);
    expect(isTreadmillFitMetadata({ session: { sport_profile_name: 'Treadmill' } })).toBe(true);
    expect(isTreadmillFitMetadata({ session: { sub_sport: 'generic' } })).toBe(false);
    expect(isTreadmillFitMetadata(null)).toBe(false);
  });

  it('prefers recorded vertical ratio, then recorded step length, then steps per minute', () => {
    const records = workoutTrace([{ seconds: 400, hr: 140, speed: 3, cadence: 180 }]).records;
    records.forEach(r => { r.verticalOscillation = 80; r.verticalRatio = 9; r.stepLength = 800; });
    expect(calculateKmSplits(records)[0].avgVertRatioPct).toBe(9);
    records.forEach(r => { r.verticalRatio = null; });
    expect(calculateKmSplits(records)[0].avgVertRatioPct).toBe(10);
    records.forEach(r => { r.stepLength = null; });
    expect(calculateKmSplits(records)[0].avgVertRatioPct).toBe(8);
  });

  it('keeps treadmill load but excludes unverified pace from outdoor baselines', () => {
    const current = { id: 'current', start_time: '2026-02-04', runType: 'easy_base', distanceKm: 5,
      efficiencyFactor: 1.1, decouplingPct: 2, steadyPaceSecKm: 400, steadyHr: 140 };
    const rows = [{ id: 'prior', start_time: '2026-02-03', run_type: 'easy_base', is_treadmill: true,
      distance_meters: 5000, efficiency_factor: 1.5, steady_pace_sec_km: 400, steady_heart_rate: 140, training_load: 40 }];
    const outdoor = buildCoachContext(rows, current);
    expect(outdoor.comparableRuns).toBe(0);
    expect(outdoor.lastSimilarRun).toBeNull();
    expect(outdoor.acute7DayLoad).toBe(40);
    const indoor = buildCoachContext(rows.map(r => ({ ...r, is_treadmill: false })), { ...current, isTreadmill: true });
    expect(indoor.baselineEf).toBeNull();
    expect(indoor.lastSimilarRun).toBeNull();
    expect(indoor.acute7DayLoad).toBe(40);
  });
});
