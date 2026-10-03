import { describe, expect, it } from 'vitest';
import { gradeRun } from '../../src/backend/physiology/coach-rubric.js';
import { generateCoachSummary } from '../../src/backend/physiology/coach-summary.js';
import { sessionVerdict } from '../../src/backend/physiology/session-verdict.js';
import { category, finding, CATEGORY_TEXT, FINDING_TEXT } from '../../src/backend/domain/coaching/vocabulary.js';
import { coachMessage, MESSAGE_TEXT } from '../../src/backend/domain/coaching/messages.js';
import { parseCoachMessages } from '../../src/shared/coaching.js';
import { en } from '../../src/frontend/i18n/en.js';
import { zh } from '../../src/frontend/i18n/zh.js';

const input = {
  runType: 'easy_base', isFailedWorkout: false, steadyHr: 135,
  steadyCadence: 178, steadyStanceTime: 240, decouplingPct: 2,
  isAccidentalTempo: false, lt1Hr: 148, lt2Hr: 167,
  maxHeartRate: 203, activityMaxHr: 150
};

describe('Stable coaching protocol', () => {
  it('provides Chinese overrides for the entire backend vocabulary', () => {
    expect(Object.keys(zh.browse.coachCategoryOverrides).sort()).toEqual(Object.keys(CATEGORY_TEXT).sort());
    expect(Object.keys(zh.browse.coachFindingOverrides).sort()).toEqual(Object.keys(FINDING_TEXT).sort());
    expect(Object.keys(zh.browse.coachMessageOverrides).sort()).toEqual(Object.keys(MESSAGE_TEXT).sort());
  });
  it.each(['easy_base', 'threshold_lt2', 'intervals_vo2', 'race'])('emits identifiers for every %s factor', runType => {
    const result = gradeRun({ ...input, runType });
    expect(result.factors.length).toBeGreaterThan(0);
    for (const factor of result.factors) {
      expect(factor.categoryId).toBeTruthy();
      expect(factor.findingId).toBeTruthy();
      expect(zh.browse.coachCategoryOverrides[factor.categoryId!]).toBeTruthy();
      expect(zh.browse.coachFindingOverrides[factor.findingId!]).toBeTruthy();
    }
  });

  it('keeps verdicts independent of presentation wording, including conflicting legacy labels', () => {
    const factors = [{ ...category('aerobic_intensity'), ...finding('extended_above_the_lt1_ceiling'), points: 0, maxPoints: 85 }];
    const context = { family: 'aerobic' as const, runType: 'easy_base', hasIntensityTelemetry: true, isFailedWorkout: false, isAccidentalTempo: false };
    expect(sessionVerdict({ ...context, factors })).toBe('off_target');
    expect(sessionVerdict({ ...context, factors: factors.map(f => ({ ...f, category: 'Different category copy', label: 'Clearly Easy' })) })).toBe('off_target');
    expect(sessionVerdict({ ...context, factors: [{ category: 'Aerobic Intensity', label: 'Clearly Easy', points: 0, maxPoints: 85 }] })).toBe('on_track');
  });

  it('keeps English API text and interpolation alongside structured messages', () => {
    const summary = generateCoachSummary({
      runType: 'easy_base', distanceKm: 10, durationMin: 60,
      avgPaceSecKm: 360, avgHr: 155, maxHr: 165, cadence: 180,
      decouplingPct: 2, efficiencyFactor: 1.2, avgTemp: 20,
      groundContactTime: 240, lt1Hr: 148, lt2Hr: 177
    });
    expect(summary.messages?.headline.text).toBe(summary.headline);
    expect(summary.messages?.recommendation.text).toBe(summary.recommendation);
    expect(parseCoachMessages(JSON.parse(JSON.stringify(summary.messages)))).toEqual(summary.messages);
    expect(coachMessage('advice.easy_recovery_lt1_ceiling', { lt1: 153 }).text).toContain('(153 bpm)');
    expect(en.browse.coachMessageOverrides).toEqual({});
  });

  it('rejects malformed and unknown persisted messages so legacy text remains usable', () => {
    const headline = coachMessage('headline.strong_aerobic_adaptation_session');
    const recommendation = coachMessage('advice.easy_recovery_lt1_ceiling', { lt1: 148 });
    expect(parseCoachMessages(undefined)).toBeUndefined();
    expect(parseCoachMessages({ headline, recommendation: { ...recommendation, id: 'future.advice' } })).toBeUndefined();
    expect(parseCoachMessages({ headline, recommendation: { ...recommendation, params: { lt1: null } } })).toBeUndefined();
    expect(parseCoachMessages({ headline, recommendation: { ...recommendation, params: [] } })).toBeUndefined();
  });
});
