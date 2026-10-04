import { describe, expect, it } from 'vitest';
import { classifyRun, CLASSIFICATION_TELEMETRY_POLICY } from '../../src/backend/ingestion/classifier.js';
import { calculateEconomy, calculateRunningHrExposure } from '../../src/backend/physiology/economy.js';
import type { ActivityMetadata, ActivityRecord } from '../../src/backend/domain/telemetry.js';
import type { DetectedInterval } from '../../src/backend/ingestion/interval-detector.js';
import { parseClassificationEvidence } from '../../src/shared/contracts/classification.js';

const profile = { maxHr: 203, restingHr: 55, lt1Hr: 148, lt2Hr: 167 };
const metadata: ActivityMetadata = { id: 'telemetry', name: '', sport: 'running', date: '2026-01-01',
  totalDistanceMeters: 6000, totalDurationSeconds: 1800, totalElapsedSeconds: 1800,
  avgHeartRate: 140, maxHeartRate: 200, avgCadence: 170, maxCadence: 180,
  calories: 0, totalAscentMeters: 0, totalDescentMeters: 0 };
const records = (duration = 1800, hr = 145): ActivityRecord[] => Array.from({ length: duration + 1 }, (_, elapsedSeconds) => ({
  elapsedSeconds, timestamp: '', heartRate: hr, cadence: 170, speedMps: 3, distanceMeters: elapsedSeconds * 3,
  altitudeMeters: 0, latitude: null, longitude: null, temperature: null, verticalOscillation: null, stanceTime: null
}));
const rep = (startSeconds: number, durationSeconds = 300): DetectedInterval => ({ intervalIndex: startSeconds, type: 'work',
  startSeconds, durationSeconds, distanceMeters: durationSeconds * 4, avgSpeedMps: 4, avgPaceSecKm: 250,
  avgHeartRate: 168, maxHeartRate: 195, avgCadence: 180 });
const classify = (trace: ActivityRecord[], intervals: DetectedInterval[] = []) => classifyRun(
  { ...metadata, totalDurationSeconds: trace.at(-1)!.elapsedSeconds }, trace, calculateEconomy(trace), intervals, profile);

describe('classification telemetry policy', () => {
  it('ignores a stationary high-HR tail and walking dilution', () => {
    const easy = records();
    easy.forEach(r => { if (r.elapsedSeconds >= 900) { r.cadence = 0; r.speedMps = 0; r.heartRate = 195; } });
    expect(classify(easy).runType).toBe('easy_base');
    const threshold = records(3600, 100);
    threshold.forEach(r => { r.cadence = 110; r.speedMps = 1; if (r.elapsedSeconds < 900) { r.cadence = 170; r.speedMps = 3; r.heartRate = 167; } });
    expect(classify(threshold).runType).toBe('threshold_lt2');
    expect(classify(threshold).evidence.measurements.thresholdHrPct).toBe(100);
  });

  it('keeps threshold reps with isolated peaks threshold', () => {
    const trace = records(2400);
    const reps = [rep(300, 600), rep(1200, 600)];
    trace.forEach(r => { if (reps.some(i => r.elapsedSeconds >= i.startSeconds && r.elapsedSeconds <= i.startSeconds + i.durationSeconds)) r.heartRate = 167; });
    trace[600].heartRate = trace[1500].heartRate = 200;
    expect(classify(trace, reps).runType).toBe('threshold_lt2');
    expect(classify(trace, reps).evidence.measurements.workVo2Seconds).toBeLessThan(4);
  });

  it('requires stimulus in work, excluding warmup and elevated recoveries', () => {
    const trace = records(1800, 190);
    const reps = [rep(300), rep(900)];
    trace.forEach(r => { if (reps.some(i => r.elapsedSeconds >= i.startSeconds && r.elapsedSeconds <= i.startSeconds + i.durationSeconds)) r.heartRate = 155; });
    const prediction = classify(trace, reps);
    expect(prediction.runType).not.toBe('intervals_vo2');
    expect(prediction.evidence.measurements.workVo2Seconds).toBe(0);
  });

  it('credits short-rep HR lag when repeated late exposure is sustained', () => {
    const trace = records();
    const reps = [rep(300, 90), rep(600, 90), rep(900, 90), rep(1200, 90)];
    trace.forEach(r => { for (const i of reps) if (r.elapsedSeconds >= i.startSeconds + 60 && r.elapsedSeconds <= i.startSeconds + 90) r.heartRate = 190; });
    expect(classify(trace, reps).runType).toBe('intervals_vo2');
    trace.forEach(r => { r.heartRate = null; });
    expect(classify(trace, reps).runType).toBe('easy_base');
  });

  it('gives equivalent exposure under dense/sparse sampling and clock shifts', () => {
    const trace = records(1800, 167);
    const dense = classify(trace);
    const sparse = classify(trace.filter(r => r.elapsedSeconds % 10 === 0));
    expect(sparse.runType).toBe(dense.runType);
    expect(sparse.evidence.measurements.thresholdHrPct).toBe(dense.evidence.measurements.thresholdHrPct);
    const shifted = trace.map(r => ({ ...r, elapsedSeconds: r.elapsedSeconds + 200 }));
    expect(calculateRunningHrExposure(shifted, 185, 162, 250, 350))
      .toEqual(calculateRunningHrExposure(trace, 185, 162, 50, 150));
  });

  it('clips boundary crossings exactly and never bridges gaps or timer pauses', () => {
    const trace = records(10, 150).filter(r => r.elapsedSeconds % 10 === 0);
    trace[1].heartRate = 190;
    const exposure = calculateRunningHrExposure(trace, 170, 160, 2, 8);
    expect(exposure.aboveCeilingSeconds).toBe(3);
    expect(exposure.atOrAboveLt1Seconds).toBe(5.5);
    expect(exposure.avgHr).toBe(170);
    trace[1].timerSegment = 1;
    expect(calculateRunningHrExposure(trace, 170, 160).validHrSeconds).toBe(0);
    trace[1].timerSegment = undefined;
    trace[1].elapsedSeconds = 20;
    expect(calculateRunningHrExposure(trace, 170, 160).validHrSeconds).toBe(0);
    const timerBoundary = [0, 10, 10, 20].map((time, index) => ({ ...records(0, 190)[0], elapsedSeconds: time, timerSegment: index < 2 ? 0 : 1 }));
    expect(calculateRunningHrExposure(timerBoundary, 170, 160).longestAboveCeilingSeconds).toBe(10);
  });

  it('lowers confidence for incomplete HR, missing movement and speed fallback', () => {
    const full = records();
    const baseline = classify(full);
    const missingHr = full.map(r => ({ ...r, heartRate: r.elapsedSeconds < 1200 ? 145 : null }));
    expect(classify(missingHr).confidence).toBeLessThan(baseline.confidence);
    const speedOnly = full.map(r => ({ ...r, cadence: null }));
    const prediction = classify(speedOnly);
    expect(prediction.confidence).toBeLessThan(baseline.confidence);
    expect(prediction.evidence.measurements.speedFallbackSeconds).toBe(1800);
    const unknown = full.map(r => ({ ...r, cadence: null, speedMps: null }));
    expect(classify(unknown).runType).toBe('easy_base');
    expect(classify(unknown).evidence.measurements.runningSeconds).toBe(0);
    expect(parseClassificationEvidence(JSON.parse(JSON.stringify(prediction.evidence)))).toEqual(prediction.evidence);
  });

  it('discounts summary/trace contradictions while keeping the trace decision', () => {
    const trace = records(2400, 167);
    const reps = [rep(300, 600), rep(1200, 600)];
    const supported = classify(trace, reps);
    const conflicting = classify(trace, reps.map(i => ({ ...i, avgHeartRate: 190 })));
    expect(conflicting.runType).toBe(supported.runType);
    expect(conflicting.confidence).toBeLessThan(supported.confidence);
    expect(conflicting.evidence.measurements.contradictoryRepCount).toBe(2);
  });

  it.each([19, 20])('enforces minimum repeated VO2 exposure at %i seconds', highSeconds => {
    const trace = records();
    const reps = [rep(300, 90), rep(600, 90)];
    // Endpoint transitions add exactly one second of integrated exposure in total.
    trace.forEach(r => { for (const i of reps) if (r.elapsedSeconds > i.startSeconds + 90 - highSeconds && r.elapsedSeconds <= i.startSeconds + 90) r.heartRate = 190; });
    // Choose a background equal to the VO2 boundary so transitions each contribute fully.
    const floor = classify(trace, reps).evidence.policy.nearMaxVo2Floor;
    trace.forEach(r => { if (r.heartRate === 145) r.heartRate = floor; });
    const result = classify(trace, reps);
    expect(result.runType === 'intervals_vo2').toBe(highSeconds >= CLASSIFICATION_TELEMETRY_POLICY.minVo2Seconds);
  });
});
