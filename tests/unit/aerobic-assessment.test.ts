import { describe, expect, it } from 'vitest';
import { assessAerobicEvidence, promoteAerobicReference, type AerobicObservation } from '../../src/shared/aerobic-assessment.js';
import { supportedThreshold } from '../../src/shared/threshold-evidence.js';
import { extractAerobicObservation } from '../../src/backend/physiology/aerobic-assessment.js';
import type { ActivityRecord } from '../../src/backend/domain/telemetry.js';

const effort = (day: number, hr = 157, paceSecKm = 348): AerobicObservation => ({
  activityId: `run-${day}`, date: `2026-08-${String(day).padStart(2, '0')}T12:00:00Z`,
  hr, paceSecKm, runningSeconds: 2400, decouplingPct: 2, basis: 'continuous'
});
const assess = (rows: AerobicObservation[], date = '2026-08-30T12:00:00Z') => assessAerobicEvidence(rows, rows.length, date);

describe('Independent aerobic reassessment', () => {
  it('corroborates a higher reference without a previous HR anchor', () => {
    expect(assess([effort(1), effort(2), effort(3)])).toMatchObject({
      reference: { hr: 157, paceSecKm: 348, supportCount: 3, stale: false }
    });
    expect(assess([effort(1, 165, 328)]).reference).toBeNull();
    expect(assess([effort(1, 165, 328)])).toMatchObject({ candidate: { hr: 165, paceSecKm: 328 } });
  });
  it('keeps slower easy runs as usable support without lowering the reference', () => {
    const result = assess([effort(1), effort(2), effort(3), effort(4, 135, 420), effort(5, 135, 420), effort(6, 135, 420)]);
    expect(result).toMatchObject({ usableRunCount: 6, latestEvidenceDate: effort(6).date,
      reference: { hr: 157, paceSecKm: 348, date: effort(3).date }, candidate: null });
  });
  it('allows comparable recovery-assisted sessions to contribute, with their basis retained', () => {
    const rows = [effort(1), effort(2), { ...effort(3), basis: 'run_walk' as const }];
    expect(assess(rows).reference).toMatchObject({ basis: 'run_walk', supportCount: 3 });
  });
  it('counts one effort per activity and excludes future, invalid and distant evidence', () => {
    expect(assess([effort(1), effort(1), effort(2)]).reference).toBeNull();
    expect(assess([effort(1), effort(2), effort(3)], effort(2).date).reference).toBeNull();
    expect(assess([{ ...effort(1), hr: NaN }, effort(2), effort(3)]).reference).toBeNull();
    expect(assess([effort(1), effort(2), { ...effort(3), date: '2026-10-03' }], '2026-10-07').reference).toBeNull();
  });
  it('retains an older reference and exposes a recent higher candidate independently', () => {
    const result = assess([effort(1), effort(2), effort(3), { ...effort(4, 165, 328), date: '2026-10-03' }], '2026-10-07');
    expect(result).toMatchObject({ reference: { hr: 157, stale: true }, candidate: { hr: 165, date: '2026-10-03' } });
  });
  it('promotes corroborated older evidence to working LT1 while retaining its age and confidence', () => {
    const accepted = supportedThreshold([], '2026-10-07');
    const assessment = assess([effort(1), effort(2), { ...effort(3), basis: 'run_walk' as const },
      { ...effort(4, 165, 328), date: '2026-10-03' }], '2026-10-07');
    expect(promoteAerobicReference(accepted, assessment, 177)).toMatchObject({ hr: 157, pace: 348,
      confidence: 0.65, evidence: { status: 'stale', supportCount: 3, method: 'aerobic_reference' } });
    expect(promoteAerobicReference(accepted, assess([effort(1, 165, 328)]), 177)).toEqual(accepted);
    expect(promoteAerobicReference(accepted, assessment, 155)).toEqual(accepted);
  });
  it('respects a later external test and never lowers a stronger accepted LT1', () => {
    const assessment = assess([effort(1), effort(2), effort(3)]);
    const external = supportedThreshold([{ sourceId: 'test', effective_date: '2026-08-20',
      hr: 150, pace: 360, confidence: 1, external: true, usable: true }], '2026-08-30');
    expect(promoteAerobicReference(external, assessment, 177)).toEqual(external);
    expect(promoteAerobicReference({ ...external, hr: 165 }, assessment, 177).hr).toBe(165);
  });
  it('requires corroborating efforts to precede the workout when replaying history', () => {
    const rows = [effort(1), effort(2), effort(3)];
    expect(assessAerobicEvidence(rows, 3, effort(3).date, { strictlyBefore: true }).reference).toBeNull();
    expect(assessAerobicEvidence(rows, 3, '2026-08-30', { excludeActivityId: 'run-2' }).reference).toBeNull();
  });
});

describe('Sustained telemetry evidence', () => {
  const records = (): ActivityRecord[] => Array.from({ length: 4801 }, (_, second) => ({
    timestamp: '', elapsedSeconds: second, heartRate: 157, speedMps: 1000 / 348,
    altitudeMeters: 0, timerActive: true, timerSegment: 0
  } as ActivityRecord));
  it('extracts higher-HR steady running without a classification or ceiling gate', () => {
    const rows = records(); rows.forEach(row => { row.heartRate = 165; });
    expect(extractAerobicObservation(rows, 'mp', '2026-10-03')).toMatchObject({
      activityId: 'mp', hr: 165, basis: 'continuous', decouplingPct: 0
    });
  });
  it('weights time instead of irregular sample density', () => {
    const rows = records().filter(row => row.elapsedSeconds < 2400 || row.elapsedSeconds % 5 === 0);
    rows.forEach(row => { row.heartRate = row.elapsedSeconds < 2400 ? 155 : 158; });
    const result = extractAerobicObservation(rows, 'irregular', '2026-10-03');
    expect(result?.hr).toBeCloseTo(156.5, 1);
  });
  it('uses settled running bouts rather than walking pace or recovery HR', () => {
    const rows = records(); rows.forEach(row => {
      if (row.elapsedSeconds % 1200 >= 1140) { row.speedMps = 1; row.heartRate = 130; }
    });
    const result = extractAerobicObservation(rows, 'assisted', '2026-10-03');
    expect(result).toMatchObject({ hr: 157, basis: 'run_walk' });
    expect(result?.paceSecKm).toBeCloseTo(348);
  });
  it('does not interpret recording gaps or timer pauses as recovery-assisted confirmation', () => {
    const rows = records().filter(row => row.elapsedSeconds < 2380 || row.elapsedSeconds > 2420);
    expect(extractAerobicObservation(rows, 'gap', '2026-10-03')).toBeNull();
    const paused = records(); paused.forEach(row => {
      if (row.elapsedSeconds >= 2380 && row.elapsedSeconds <= 2420) row.timerActive = false;
    });
    expect(extractAerobicObservation(paused, 'pause', '2026-10-03')).toBeNull();
  });
  it('rejects rising strain, unstable speed and hills', () => {
    for (const problem of ['drift', 'speed', 'hills']) {
      const rows = records(); rows.forEach(row => {
        if (problem === 'drift' && row.elapsedSeconds >= 2400) row.heartRate = 180;
        if (problem === 'speed') row.speedMps = row.elapsedSeconds % 100 < 50 ? 2 : 4;
        if (problem === 'hills') row.altitudeMeters = row.elapsedSeconds;
      });
      expect(extractAerobicObservation(rows, problem, '2026-10-03')).toBeNull();
    }
  });
  it('does not reset the drift clock at a later stable high-HR plateau', () => {
    const rows = Array.from({ length: 7201 }, (_, second): ActivityRecord => ({
      timestamp: '', elapsedSeconds: second, heartRate: second < 1800 ? 150 : 170,
      speedMps: second >= 1740 && second < 1800 ? 1 : 1000 / 348,
      altitudeMeters: 0, timerActive: true, timerSegment: 0
    } as ActivityRecord));
    expect(extractAerobicObservation(rows, 'late-plateau', '2026-10-03')).toBeNull();
  });
});
