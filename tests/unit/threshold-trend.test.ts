import { describe, it, expect } from 'vitest';
import { rollingThreshold } from '../../src/shared/threshold-trend.js';

const observation = (effective_date: string, pace: number, hr = 150) =>
  ({ effective_date, pace, hr, confidence: 0.9 });

describe('Historical rolling threshold', () => {
  it('dampens isolated changes using the same confidence and recency weighting as the current baseline', () => {
    const rows = [observation('2026-05-01 12:00:00', 400), observation('2026-05-10T12:00:00', 360)];
    expect(rollingThreshold(rows, '2026-05-10 12:00:00')?.pace).toBe(378);
  });
  it('never uses later results to rewrite earlier fitness', () => {
    const rows = [observation('2026-05-01', 400), observation('2026-05-10', 300)];
    expect(rollingThreshold(rows, '2026-05-01')?.pace).toBe(400);
    expect(rollingThreshold(rows, '2026-04-01')).toBeNull();
  });
  it('allows sustained change and does not anchor a new training period to old fitness', () => {
    const rows = [observation('2025-11-01', 500), observation('2026-05-01', 360)];
    expect(rollingThreshold(rows, '2026-05-01')?.pace).toBe(360);
  });

  it('does not promote zero-confidence observations to 85% confidence', () => {
    const trusted = observation('2026-05-01', 400);
    const rejected = { ...observation('2026-05-10', 250, 180), confidence: 0 };
    expect(rollingThreshold([trusted, rejected], '2026-05-10')).toEqual(rollingThreshold([trusted], '2026-05-10'));
    expect(rollingThreshold([rejected], '2026-05-10')).toBeNull();
  });

  it('does not let invalid or rejected entries crowd out usable evidence', () => {
    const trusted = observation('2026-05-01', 400);
    const rows = [trusted, ...Array.from({ length: 6 }, () => ({ ...observation('2026-05-10', 250), confidence: 0 }))];
    rows.push({ ...observation('2026-05-10', 200), hr: NaN });
    rows.push({ ...observation('2026-05-10', 200), confidence: Infinity });
    rows.push(observation('invalid-date', 200));
    expect(rollingThreshold(rows, '2026-05-10')).toEqual(rollingThreshold([trusted], '2026-05-10'));
  });

  it('ignores invalid pace without discarding valid HR evidence', () => {
    const result = rollingThreshold([{ ...observation('2026-05-01', Infinity), hr: 150 }], '2026-05-01');
    expect(result?.hr).toBe(150);
    expect(result?.pace).toBeNull();
    expect(rollingThreshold([observation('2026-05-01', 400)], 'invalid-date')).toBeNull();
  });
});
