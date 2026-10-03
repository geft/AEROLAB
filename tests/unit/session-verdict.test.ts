import { describe, expect, it } from 'vitest';
import { generateCoachSummary } from '../../src/backend/physiology/coach-summary.js';
import { sessionVerdict } from '../../src/backend/physiology/session-verdict.js';
import { parseSessionVerdict } from '../../src/shared/session-verdict.js';
import type { CoachingFactor } from '../../src/shared/coaching.js';

const factor = (category: string, label: string): CoachingFactor => ({ category, label, points: 0, maxPoints: 100 });
const base = {
  family: 'aerobic' as const, runType: 'easy_base', hasIntensityTelemetry: true,
  isFailedWorkout: false, isAccidentalTempo: false,
  factors: [factor('Aerobic Intensity', 'Disciplined Aerobic Ceiling'), factor('Workout Completion', 'Unbroken Session')]
};

describe('Session verdicts', () => {
  it('uses purpose findings, never the aggregate score or cadence observations', () => {
    expect(sessionVerdict({ ...base, factors: [...base.factors, factor('Running Turnover', 'Low Cadence')] })).toBe('on_track');
  });
  it('distinguishes mild intensity drift from a substantially over-intensity run', () => {
    expect(sessionVerdict({ ...base, factors: [factor('Aerobic Intensity', 'Drifting Into High Zone 2')] })).toBe('some_deviation');
    expect(sessionVerdict({ ...base, factors: [factor('Aerobic Intensity', 'Clearly Easy')] })).toBe('on_track');
    expect(sessionVerdict({ ...base, factors: [factor('Aerobic Intensity', 'Normal Easy')] })).toBe('on_track');
    expect(sessionVerdict({ ...base, factors: [factor('Aerobic Intensity', 'Upper Easy / Aerobic Steady')] })).toBe('some_deviation');
    expect(sessionVerdict({ ...base, factors: [factor('Aerobic Intensity', 'Potentially Too Close to LT1')] })).toBe('some_deviation');
    expect(sessionVerdict({ ...base, factors: [factor('Aerobic Intensity', 'Extended Above the LT1 Ceiling')] })).toBe('off_target');
  });
  it('does not certify missing, unsupported or unknown evidence', () => {
    expect(sessionVerdict({ ...base, hasIntensityTelemetry: false })).toBe('insufficient_evidence');
    expect(sessionVerdict({ ...base, factors: [] })).toBe('insufficient_evidence');
    expect(sessionVerdict({ ...base, runType: 'strides' })).toBe('insufficient_evidence');
    expect(parseSessionVerdict('gold')).toBe('insufficient_evidence');
  });
  it('recognises known incomplete or accidental-tempo sessions', () => {
    expect(sessionVerdict({ ...base, isFailedWorkout: true })).toBe('off_target');
    expect(sessionVerdict({ ...base, isAccidentalTempo: true })).toBe('off_target');
  });
  it('requires interval structure and intensity evidence for quality sessions', () => {
    const quality = { ...base, family: 'quality' as const, runType: 'intervals_vo2', factors: [
      factor('Pacing Discipline', 'On-Target Intensity Control'), factor('Interval Execution', 'Laser Rep Consistency')
    ] };
    expect(sessionVerdict(quality)).toBe('on_track');
    expect(sessionVerdict({ ...quality, factors: quality.factors.slice(0, 1) })).toBe('insufficient_evidence');
    expect(sessionVerdict({ ...quality, factors: [...quality.factors, factor('Rep-to-Rep Fatigue', 'Slight Late-Rep Fade')] })).toBe('some_deviation');
    expect(sessionVerdict({ ...quality, factors: [...quality.factors, factor('Rep-to-Rep Fatigue', 'Late-Rep Collapse')] })).toBe('off_target');
  });
  it('uses threshold-zone exposure as the primary threshold verdict', () => {
    const threshold = { ...base, family: 'quality' as const, runType: 'threshold_lt2', factors: [
      factor('Threshold Zone Time', 'Sustained Threshold Heart Rate'),
      factor('Rep-to-Rep Fatigue', 'Late-Rep Collapse')
    ] };
    expect(sessionVerdict(threshold)).toBe('on_track');
    expect(sessionVerdict({ ...threshold, factors: [factor('Threshold Zone Time', 'Partial Threshold Exposure')] })).toBe('some_deviation');
    expect(sessionVerdict({ ...threshold, factors: [factor('Threshold Zone Time', 'Little Threshold Exposure')] })).toBe('off_target');
  });
  it('does not equate a conservatively run race with failure', () => {
    expect(sessionVerdict({ ...base, family: 'race', runType: 'race', factors: [
      factor('Race Pacing Execution', 'Controlled Race Pacing'), factor('Race Finish Execution', 'Held Form to the Line'),
      factor('Cardiovascular Stimulus', 'Conservative Heart Rate Ceiling')
    ] })).toBe('on_track');
  });
});

describe('Marathon-pace long-run context', () => {
  it('honours the MP tag instead of applying easy-run intensity rules', () => {
    const input = {
      runType: 'long_run', distanceKm: 18, durationMin: 114, avgPaceSecKm: 365,
      avgHr: 155, maxHr: 165, cadence: 180, decouplingPct: 1, efficiencyFactor: 1.2,
      avgTemp: 30, groundContactTime: 240, lt1Hr: 153, lt2Hr: 177,
      records: Array.from({ length: 1200 }, (_, sec) => ({ elapsed_seconds: sec, heart_rate: 160, cadence: 180, speed_mps: 3, distance_m: sec * 3 }))
    };
    const easyLong = generateCoachSummary(input);
    expect(easyLong.keyInsights.some(text => text.startsWith('Over-Intensity:'))).toBe(true);
    const mpLong = generateCoachSummary({ ...input, sessionTags: ['Long Run', 'Marathon Pace'] });
    expect(mpLong.verdict).toBe('insufficient_evidence');
    expect(mpLong.headline).toBe('Marathon-Pace Long Run');
    expect(mpLong.keyInsights.some(text => /Over-Intensity:|Grey-Zone Creep:|easy-day label/.test(text))).toBe(false);
    expect(mpLong.keyInsights.some(text => text.startsWith('Marathon-Pace Context:'))).toBe(true);
  });
});
