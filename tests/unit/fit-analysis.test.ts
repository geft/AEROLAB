import { describe, expect, it } from 'vitest';
import { prepareFitAnalysis } from '../../src/backend/ingestion/fit-analysis.js';
import { detectIntervals } from '../../src/backend/ingestion/interval-detector.js';
import { classifyRun } from '../../src/backend/ingestion/classifier.js';
import { continuousRaceEffort } from '../../src/backend/ingestion/continuous-effort.js';
import { calculateEconomy, extractSteadyStateMetrics } from '../../src/backend/physiology/economy.js';
import { observedDuration } from '../../src/backend/physiology/time-series.js';
import { recordDurationSeconds } from '../../src/backend/physiology/zones.js';
import { workoutTrace } from '../fixtures/workout-trace.js';

const profile = { maxHr: 195, restingHr: 55, lt1Hr: 145, lt2Hr: 170 };
const date = '2026-02-02T12:00:00';
const utc = (seconds: number) => new Date(Date.parse(`${date}Z`) + seconds * 1000).toISOString();
const event = (seconds: number, event_type: string) => ({ event: 'timer', event_type, timestamp: utc(seconds) });
const lap = (start: number, seconds: number, intensity: string) => ({ start_time: utc(start), total_elapsed_time: seconds, intensity });
function trace(seconds = 600, hr = 175) {
  const result = workoutTrace([{ seconds, hr, cadence: 175, speed: 3 }]);
  result.records = result.records.map(record => ({ ...record, timestamp: utc(record.elapsedSeconds).replace('Z', '') }));
  return result;
}

describe('FIT structure evidence', () => {
  it('aligns UTC messages with exported local records and a delayed first sample', () => {
    const run = trace();
    run.records = run.records.slice(5).map(record => ({ ...record,
      elapsedSeconds: record.elapsedSeconds - 5,
      timestamp: new Date(Date.parse(record.timestamp + 'Z') + 28800000).toISOString().replace('Z', '') }));
    const analysis = prepareFitAnalysis(run.records, { utcOffsetSeconds: 28800, events: [event(100, 'stopAll'), event(110, 'start')] });
    expect(analysis.records.find(record => record.elapsedSeconds === 95)?.timerActive).toBe(false);
    expect(analysis.records.find(record => record.elapsedSeconds === 105)?.timerActive).toBe(true);
    expect(observedDuration(analysis.records, record => record.elapsedSeconds)).toBe(584);
    expect(run.records.every(record => record.timerActive === undefined)).toBe(true);
  });

  it('breaks continuous race evidence on even a short pause and excludes stopped HR', () => {
    const run = trace(600, 190);
    expect(continuousRaceEffort(run.records, profile)).not.toBeNull();
    const analysis = prepareFitAnalysis(run.records, { events: [event(299, 'stop_all'), event(301, 'start')] });
    expect(continuousRaceEffort(analysis.records, profile)).toBeNull();
    expect(recordDurationSeconds(analysis.records, 299)).toBe(0);
    expect(recordDurationSeconds(analysis.records, 298)).toBe(0);
    expect(extractSteadyStateMetrics(analysis.records).stopDurationSeconds).toBe(2);
    expect(detectIntervals(analysis.records, { ...profile, isRace: true }).every(interval =>
      interval.startSeconds + interval.durationSeconds <= 299 || interval.startSeconds >= 301)).toBe(true);
  });

  it('keeps long stopped stretches out of threshold occupancy and recovery exposure', () => {
    const run = trace(1200, 130);
    run.records.forEach(record => { if (record.elapsedSeconds >= 300 && record.elapsedSeconds < 1000) record.heartRate = 180; });
    const analysis = prepareFitAnalysis(run.records, { events: [event(300, 'stopAll'), event(1000, 'start')] });
    const intervals = detectIntervals(analysis.records, profile);
    expect(classifyRun(run.metadata, analysis.records, calculateEconomy(analysis.records), intervals, profile).runType).toBe('recovery');
    expect(extractSteadyStateMetrics(analysis.records).stopDurationSeconds).toBe(700);
  });

  it('uses explicit recovery laps to separate quality repetitions despite HR lag and flat speed', () => {
    const run = trace(1080, 170);
    const analysis = prepareFitAnalysis(run.records, { laps: [lap(0, 480, 'active'), lap(480, 120, 'recovery'), lap(600, 480, 'active')] });
    const intervals = detectIntervals(analysis.records, { ...profile, laps: analysis.laps });
    expect(intervals.map(interval => [interval.type, interval.durationSeconds])).toEqual([['work', 480], ['recovery', 120], ['work', 480]]);
    expect(classifyRun(run.metadata, analysis.records, calculateEconomy(analysis.records), intervals, profile).runType).toBe('threshold_lt2');
  });

  it('does not turn ordinary active distance laps or easy scheduled laps into quality reps', () => {
    const run = trace(1200, 135);
    for (const laps of [[lap(0, 600, 'active'), lap(600, 600, 'active')],
      [lap(0, 480, 'active'), lap(480, 240, 'recovery'), lap(720, 480, 'active')]]) {
      const analysis = prepareFitAnalysis(run.records, { laps });
      expect(detectIntervals(run.records, { ...profile, laps: analysis.laps })).toEqual(detectIntervals(run.records, profile));
    }
  });

  it('accepts subsecond lap overlap from FIT timestamp precision and retains short hard reps', () => {
    const run = trace(300, 185);
    const analysis = prepareFitAnalysis(run.records, { laps: [lap(0, 90.9, 'active'), lap(90, 120.8, 'recovery'), lap(210, 90, 'active')] });
    const intervals = detectIntervals(run.records, { ...profile, laps: analysis.laps });
    expect(intervals.map(interval => [interval.type, interval.durationSeconds])).toEqual([['work', 90], ['recovery', 120], ['work', 90]]);
    expect(classifyRun(run.metadata, run.records, calculateEconomy(run.records), intervals, profile).runType).toBe('intervals_vo2');
  });

  it('retains lower-HR late active reps so failed-workout evidence is visible', () => {
    const run = trace(1620, 175);
    run.records.forEach(record => { if (record.elapsedSeconds >= 1140) record.heartRate = 150; });
    const analysis = prepareFitAnalysis(run.records, { laps: [lap(0, 480, 'active'), lap(480, 90, 'recovery'),
      lap(570, 480, 'active'), lap(1050, 90, 'recovery'), lap(1140, 480, 'active')] });
    const intervals = detectIntervals(run.records, { ...profile, laps: analysis.laps });
    expect(intervals.filter(interval => interval.type === 'work')).toHaveLength(3);
    expect(classifyRun(run.metadata, run.records, calculateEconomy(run.records), intervals, profile)).toMatchObject({ runType: 'threshold_lt2', isFailedWorkout: true });
  });

  it('preserves telemetry-detected strides inside a structured warmup', () => {
    const run = workoutTrace([{ seconds: 180, hr: 130, speed: 3 },
      { seconds: 20, hr: 140, speed: 6.5, cadence: 195 }, { seconds: 120, hr: 130, speed: 1, cadence: 100 },
      { seconds: 480, hr: 175, speed: 3 }, { seconds: 120, hr: 150, speed: 2 }, { seconds: 480, hr: 175, speed: 3 }]);
    const baseline = detectIntervals(run.records, profile).filter(interval => interval.type === 'stride');
    expect(baseline).not.toHaveLength(0);
    const intervals = detectIntervals(run.records, { ...profile, laps: [
      { start: 0, end: 320, intensity: 'warmup' }, { start: 320, end: 800, intensity: 'active' },
      { start: 800, end: 920, intensity: 'recovery' }, { start: 920, end: 1400, intensity: 'active' }
    ] });
    expect(intervals.filter(interval => interval.type === 'stride')).toEqual(baseline);
    expect(intervals.filter(interval => interval.type === 'work')).toHaveLength(2);
  });

  it('falls back for absent, malformed, overlapping or incomplete lap evidence', () => {
    const run = trace();
    expect(prepareFitAnalysis(run.records)).toEqual({ records: run.records, laps: [] });
    expect(prepareFitAnalysis(run.records, { events: [{ event: 'timer', timestamp: 'invalid' }], laps: [null, lap(0, 300, 'active'), lap(200, 300, 'recovery')] }))
      .toEqual({ records: run.records, laps: [] });
    const analysis = prepareFitAnalysis(run.records, { laps: [lap(0, 480, 'active'), lap(480, 60, 'cooldown')] });
    expect(detectIntervals(run.records, { ...profile, laps: analysis.laps })).toEqual(detectIntervals(run.records, profile));
  });

  it('prefers valid measured running dynamics and retains derived fallback', () => {
    const run = trace(600, 175);
    run.records.forEach(record => { record.stepLength = 1.23; record.verticalRatio = 6.4; });
    const intervals = detectIntervals(run.records, { ...profile, isRace: true });
    expect(intervals[0]).toMatchObject({ avgStepLength: 1.23, avgStrideLength: 2.46, avgVertRatio: 6.4 });
    run.records.forEach(record => { record.stepLength = -1; record.verticalRatio = NaN; });
    const fallback = detectIntervals(run.records, { ...profile, isRace: true });
    expect(fallback[0].avgStepLength).toBeGreaterThan(0);
    expect(fallback[0].avgVertRatio).toBeGreaterThan(0);
  });
});
