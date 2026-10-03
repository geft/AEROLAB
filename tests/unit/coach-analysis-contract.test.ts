import { describe, expect, it } from 'vitest';
import { parseCoachContext, parseInsightTones, parsePauseBreakdown, parseScoreFactors, parseWalkAudit } from '../../src/shared/contracts/coach-analysis.js';
import { parseClassificationEvidence } from '../../src/shared/contracts/classification.js';
import { parseAnalysisProvenance } from '../../src/shared/analysis-revision.js';

describe('persisted coaching contracts', () => {
  it('retains legacy factors and rejects invalid numbers and machine IDs', () => {
    const legacy = { category: 'Legacy factor', label: 'English fallback', points: 10 };
    expect(parseScoreFactors([legacy, { ...legacy, points: NaN }, { ...legacy, categoryId: 'unknown' }])).toEqual([legacy]);
    expect(parseInsightTones(['neutral', 'negative'])).toEqual(['neutral', 'negative']);
    expect(parseInsightTones(['neutral', 'not_a_tone'])).toEqual([]);
    expect(parsePauseBreakdown({ stopCount: 2 })).toEqual({ stopCount: 2 });
    expect(parsePauseBreakdown({ stopCount: '2' })).toBeNull();
    expect(parseCoachContext({ comparableRuns: '2' })).toBeNull();
    expect(parseWalkAudit({ walkSec: Infinity })).toBeNull();
  });

  it('requires an explicit heuristic confidence contract and historical profile', () => {
    const evidence = { ruleId: 'aerobic_default', confidence: { kind: 'heuristic', score: 0.8 }, measurements: { hr: null }, policy: { lt1Hr: 145 } };
    expect(parseClassificationEvidence(evidence)).toEqual(evidence);
    expect(parseClassificationEvidence({ ...evidence, confidence: { kind: 'probability', score: 0.8 } })).toBeUndefined();
    expect(parseClassificationEvidence({ ...evidence, policy: { lt1Hr: NaN } })).toBeUndefined();
    expect(parseAnalysisProvenance({ revision: 'v1', workoutStartTime: '2026-01-01', telemetryPolicy: 'fit-timer-and-observed-gaps-v1', historicalProfile: { maxHr: 190, restingHr: 50, lt1Hr: 145, lt2Hr: 170 } })).toBeDefined();
    expect(parseAnalysisProvenance({ historicalProfile: {} })).toBeUndefined();
  });
});
