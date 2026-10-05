import { describe, expect, it } from 'vitest';
import { supportedThreshold, type ThresholdEvidenceObservation } from '../../src/shared/threshold-evidence.js';
import { usableThresholdSegment } from '../../src/backend/physiology/threshold-evidence.js';
import type { ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';

const observation = (day: number, pace = 360, hr = 150, overrides: Partial<ThresholdEvidenceObservation> = {}): ThresholdEvidenceObservation => ({
  effective_date: `2026-06-${String(day).padStart(2, '0')}T12:00:00Z`, pace, hr, confidence: 0.9,
  sourceId: `run:${day}`, external: false, usable: true, ...overrides
});
const estimate = (rows: ThresholdEvidenceObservation[], date = '2026-06-30T12:00:00Z') =>
  supportedThreshold(rows, date, { aerobicAnchorHr: 150 });

describe('Corroborated threshold evidence', () => {
  it('requires independent corroboration before bootstrapping a pace', () => {
    expect(estimate([observation(1)]).pace).toBeNull();
    expect(estimate([observation(1), observation(2)]).pace).toBe(360);
    expect(estimate([observation(1), observation(2, 360, 150, { sourceId: 'run:1' })]).pace).toBeNull();
  });
  it('uses the same HR tolerance for the ceiling and comparable aerobic observations', () => {
    expect(estimate([observation(1, 369, 147), observation(2, 363, 149)]).pace).toBe(369);
    expect(estimate([observation(1, 369, 146), observation(2, 363, 149)]).pace).toBeNull();
    expect(estimate([observation(1, 369, 154), observation(2, 363, 154)]).pace).toBeNull();
  });
  it('holds LT1 across several slower recovery runs without ratcheting its HR', () => {
    const initial = [observation(1), observation(2)];
    const result = estimate([...initial, observation(3, 400, 145), observation(4, 420, 142), observation(5, 410, 140)]);
    expect(result).toMatchObject({ hr: 150, pace: 360, latestDate: initial[1].effective_date,
      evidence: { status: 'held', supportCount: 2 } });
  });
  it('requires three comparable efforts to accept a slower pace, without lowering LT1 HR', () => {
    const initial = [observation(1), observation(2)];
    const slower = [observation(3, 400, 149), observation(4, 402, 150), observation(5, 401, 151)];
    expect(estimate([...initial, ...slower.slice(0, 2)]).pace).toBe(360);
    expect(estimate([...initial, ...slower])).toMatchObject({ hr: 150, pace: 401, evidence: { supportCount: 3 } });
  });
  it('accepts corroborated faster efforts and ignores a single fast outlier', () => {
    const initial = [observation(1), observation(2)];
    expect(estimate([...initial, observation(3, 330)]).pace).toBe(360);
    expect(estimate([...initial, observation(3, 330), observation(4, 332)]).pace).toBe(332);
  });
  it('does not refresh accepted evidence with summaries, drift or interrupted efforts', () => {
    const initial = [observation(1), observation(2)];
    const result = estimate([...initial, ...[3, 4, 5].map(day => observation(day, 400, 150, { usable: false }))]);
    expect(result.latestDate).toBe(initial[1].effective_date);
    expect(result.pace).toBe(360);
  });
  it('holds old evidence while marking it stale', () => {
    const result = estimate([observation(1), observation(2)], '2026-09-30');
    expect(result).toMatchObject({ pace: 360, evidence: { status: 'stale', acceptedDate: observation(2).effective_date } });
  });
  it('does not count future or same-instant evidence in a historical profile', () => {
    const rows = [observation(1), observation(2), observation(3, 320), observation(4, 320)];
    expect(estimate(rows, observation(2).effective_date).pace).toBe(360);
    expect(supportedThreshold(rows, observation(2).effective_date, { strictlyBefore: true }).pace).toBeNull();
  });
  it('does not combine efforts from different training periods or known temperatures', () => {
    expect(estimate([observation(1), { ...observation(2), effective_date: '2026-08-02' }], '2026-08-03').pace).toBeNull();
    expect(estimate([observation(1, 360, 150, { temperatureC: 25 }), observation(2, 360, 150, { temperatureC: 32 })]).pace).toBeNull();
    const baseline = [observation(1, 360, 150, { temperatureC: 25 }), observation(2, 360, 150, { temperatureC: 25 })];
    expect(estimate([...baseline, ...[3, 4, 5].map(day => observation(day, 400, 150, { temperatureC: 32 }))]).pace).toBe(360);
  });
  it('accepts dated external tests, but an HR-only test cannot invent a pace', () => {
    expect(estimate([observation(1, 355, 154, { external: true, usable: false })])).toMatchObject({ hr: 154, pace: 355 });
    expect(estimate([observation(1, 355, 154, { external: true }), observation(2, 360, 153, { external: true, pace: null })]))
      .toMatchObject({ hr: 153, pace: 355, evidence: { acceptedDate: observation(1).effective_date,
        heartRateDate: observation(2).effective_date, status: 'held' } });
  });
  it('applies the same hold and corroboration policy to LT2', () => {
    const initial = [observation(1, 275, 178), observation(2, 275, 179)];
    const slower = [3, 4, 5].map(day => observation(day, 300, 170));
    expect(supportedThreshold([...initial, ...slower.slice(0, 2)], '2026-06-30').pace).toBe(275);
    expect(supportedThreshold([...initial, ...slower], '2026-06-30')).toMatchObject({ pace: 300, hr: 170 });
  });
  it('rejects invalid dates, metrics and zero confidence', () => {
    expect(estimate([observation(1, 360, 150, { confidence: 0 }), observation(2, Infinity),
      observation(3, 360, NaN), observation(4, 360, 150, { effective_date: 'invalid' })]).pace).toBeNull();
  });
});

describe('Threshold telemetry screening', () => {
  const records = (): ActivityRecord[] => Array.from({ length: 1201 }, (_, elapsedSeconds) => ({
    elapsedSeconds, heartRate: 150, speedMps: 2.8, cadence: 175, altitudeMeters: 10, timerActive: true, timerSegment: 0
  } as ActivityRecord));
  it('accepts steady uninterrupted running', () => expect(usableThresholdSegment(records(), 0, 1200)).toBe(true));
  it.each(['walk', 'pause', 'gap', 'drift', 'hills', 'unstable'] as const)('rejects %s evidence', problem => {
    let rows = records();
    if (problem === 'walk') rows[600].speedMps = 1;
    if (problem === 'pause') rows[600].timerActive = false;
    if (problem === 'gap') rows = rows.filter(r => r.elapsedSeconds < 500 || r.elapsedSeconds > 550);
    if (problem === 'drift') rows.forEach(r => { if (r.elapsedSeconds >= 600) r.heartRate = 165; });
    if (problem === 'hills') rows.forEach(r => { r.altitudeMeters = r.elapsedSeconds / 5; });
    if (problem === 'unstable') rows.forEach(r => { r.speedMps = r.elapsedSeconds % 100 < 50 ? 2 : 4; });
    expect(usableThresholdSegment(rows, 0, 1200)).toBe(false);
  });
});
