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
});
