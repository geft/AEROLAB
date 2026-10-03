import { describe, expect, it } from 'vitest';
import { analyzeWorkout, prepareAnalysisContext } from '../../src/backend/application/analysis/analyze-workout.js';
import { CONFIRMED_PROFILE, CONFIRMED_RUNS } from '../fixtures/confirmed-runs.js';
import { workoutTrace } from '../fixtures/workout-trace.js';

describe('Shared workout analysis contract', () => {
  const profile = { maxHr: 190, restingHr: 50, lt1Hr: 140, lt2Hr: 170 };

  it('isolates stopped FIT telemetry without changing raw records', () => {
    const run = workoutTrace([{ seconds: 300, hr: 125 }, { seconds: 700, hr: 190 }, { seconds: 200, hr: 125 }]);
    const original = structuredClone(run.records);
    const origin = Date.parse(run.records[0].timestamp);
    const utc = (seconds: number) => new Date(origin + seconds * 1000).toISOString();
    const context = prepareAnalysisContext({ metadata: run.metadata, rawRecords: run.records,
      historicalProfile: profile, fitMetadata: { events: [
        { timestamp: utc(300), event: 'timer', event_type: 'stopAll' },
        { timestamp: utc(1000), event: 'timer', event_type: 'start' }
      ] } });
    const result = analyzeWorkout(context);
    expect(result.classification.runType).toBe('recovery');
    expect(result.economy.pauseBreakdown?.stopDurationSeconds).toBe(700);
    expect(context.records.find(record => record.elapsedSeconds === 600)?.timerActive).toBe(false);
    expect(context.rawRecords).toBe(run.records);
    expect(run.records).toEqual(original);

    // A decoder cache describes raw telemetry and must not bypass timer policy.
    const raw = analyzeWorkout(prepareAnalysisContext({ metadata: run.metadata,
      rawRecords: run.records, historicalProfile: profile }));
    expect(analyzeWorkout(context, { precomputed: raw })).toEqual(result);
  });

  it('reuses raw metric caches only when timer annotation is absent', () => {
    const run = workoutTrace([{ seconds: 2400, hr: 145 }]);
    const context = prepareAnalysisContext({ metadata: run.metadata, rawRecords: run.records, historicalProfile: profile });
    const first = analyzeWorkout(context);
    const repeated = analyzeWorkout(context, { precomputed: first });
    expect(context.hasTimerAnnotations).toBe(false);
    expect(repeated.economy).toBe(first.economy);
    expect(repeated.splits).toBe(first.splits);
    expect(repeated).toEqual(first);
  });

  it.each(CONFIRMED_RUNS)('preserves confirmation and independent prediction for $id', run => {
    const context = prepareAnalysisContext({ metadata: run.metadata, rawRecords: run.records,
      historicalProfile: CONFIRMED_PROFILE });
    const automatic = analyzeWorkout(context);
    const confirmed = analyzeWorkout(context, { confirmedRunType: run.expectedRunType });
    expect(confirmed.runType).toBe(run.expectedRunType);
    expect(confirmed.classification).toEqual(automatic.classification);
    expect(confirmed.tags[0]).toBe({ easy_base: 'Easy Base', long_run: 'Long Run', recovery: 'Recovery',
      threshold_lt2: 'Threshold', intervals_vo2: 'VO2 Max', race: 'Race' }[run.expectedRunType]);
    expect(analyzeWorkout(context, { confirmedRunType: run.expectedRunType })).toEqual(confirmed);
  });

  it('segments confirmed races while retaining the automatic aerobic label', () => {
    const run = workoutTrace([{ seconds: 1200, hr: 145 }]);
    const result = analyzeWorkout(prepareAnalysisContext({ metadata: run.metadata, rawRecords: run.records,
      historicalProfile: profile }), { confirmedRunType: 'race' });
    expect(result.runType).toBe('race');
    expect(result.classification.runType).toBe('easy_base');
    expect(result.tags).toContain('Race');
    expect(result.intervals.some(interval => interval.type === 'work')).toBe(true);
  });
});
