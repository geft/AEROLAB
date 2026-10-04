import { describe, expect, it } from 'vitest';
import { generateCoachSummary } from '../../src/backend/physiology/coach-summary.js';
import { auditWalkBreaks, walkSharePct } from '../../src/backend/physiology/coach-rubric.js';
import { extractSteadyStateMetrics } from '../../src/backend/physiology/economy.js';
import { workoutTrace } from '../fixtures/workout-trace.js';

const base = {
  runType: 'easy_base', distanceKm: 8, durationMin: 45, avgPaceSecKm: 333,
  avgHr: 140, maxHr: 160, cadence: 175, decouplingPct: 8,
  efficiencyFactor: 1.2, avgTemp: null, groundContactTime: 240,
  lt1Hr: 150, lt2Hr: 175, maxHeartRate: 195
};

describe('Running evidence in coach summaries', () => {
  it('reports drift without inventing tempo when running HR stays below LT1', () => {
    const records = workoutTrace([{ seconds: 2700, hr: 140 }]).records;
    const summary = generateCoachSummary({ ...base, records });
    expect(summary.verdict).toBe('on_track');
    expect(summary.effectivenessScore).toBe(98);
    expect(summary.headline).toBe('Near-Perfect Aerobic Base Execution');
    expect(summary.keyInsights.some(text => text.startsWith('Noticeable cardiac drift'))).toBe(true);
    expect(summary.keyInsights.some(text => text.startsWith('Pacing Alert'))).toBe(false);
    expect(summary.walkAudit?.walkSec).toBe(0);
  });

  it('prefers running telemetry over a conflicting high summary average', () => {
    const records = workoutTrace([{ seconds: 2700, hr: 140 }]).records;
    const summary = generateCoachSummary({ ...base, avgHr: 160, records });
    expect(summary.verdict).toBe('on_track');
    expect(summary.effectivenessScore).toBe(98);
    expect(summary.keyInsights.some(text => text.startsWith('Pacing Alert'))).toBe(false);
  });

  it('detects sustained ceiling breaches even when the summary average is low', () => {
    const records = workoutTrace([{ seconds: 2700, hr: 160 }]).records;
    const summary = generateCoachSummary({ ...base, records });
    expect(summary.verdict).toBe('off_target');
    expect(summary.effectivenessScore).toBeLessThanOrEqual(69);
    expect(summary.headline).toBe('Unintentional Tempo / Drifted Aerobic Run');
    expect(summary.keyInsights.some(text => text.startsWith('Over-Intensity'))).toBe(true);
  });

  it('does not turn a brief ceiling excursion into an accidental tempo session', () => {
    const records = workoutTrace([
      { seconds: 2400, hr: 140 }, { seconds: 300, hr: 160 }
    ]).records;
    const summary = generateCoachSummary({ ...base, decouplingPct: null, records });
    expect(summary.headline).not.toBe('Unintentional Tempo / Drifted Aerobic Run');
    expect(summary.keyInsights.some(text => text.startsWith('Pacing Alert'))).toBe(false);
  });

  it('excludes stationary time from moving-time walk share in both evidence paths', () => {
    const trace = workoutTrace([
      { seconds: 300, hr: 140 },
      { seconds: 60, hr: 140, cadence: 100, speed: 1 },
      { seconds: 300, hr: 140 },
      { seconds: 600, hr: 120, cadence: 0, speed: 0 }
    ]);
    const movingTrace = workoutTrace([
      { seconds: 300, hr: 140 },
      { seconds: 60, hr: 140, cadence: 100, speed: 1 },
      { seconds: 300, hr: 140 },
      { seconds: 1, hr: 120, cadence: 0, speed: 0 }
    ]);
    const options = { lt1Hr: 150, lt2Hr: 175 };
    const audit = auditWalkBreaks(trace.records, options)!;
    const movingAudit = auditWalkBreaks(movingTrace.records, options)!;
    expect(audit.walkSec).toBe(movingAudit.walkSec);
    expect(audit.movingSec).toBe(movingAudit.movingSec);
    const pauses = extractSteadyStateMetrics(trace.records);
    expect(walkSharePct(pauses)).toBeCloseTo(
      pauses.walkDurationSeconds / (pauses.steadyRunningDurationSeconds + pauses.walkDurationSeconds) * 100
    );
  });
});
