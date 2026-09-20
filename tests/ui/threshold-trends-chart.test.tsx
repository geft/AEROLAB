// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThresholdTrendsChart, CalibrationHistoryItem } from '../../src/frontend/components/ThresholdTrendsChart.js';

afterEach(cleanup);
describe('Threshold chart date ranges', () => {
  it('keeps overlapping estimates identical and preserves access to individual observations', () => {
    const history: CalibrationHistoryItem[] = [
      ['2025-11-01', 500], ['2026-06-01', 400], ['2026-07-01', 360], ['2026-09-01', 355]
    ].map(([date, pace], id) => ({ id, effective_date: String(date), lt1_hr: 150,
      lt1_pace_sec_km: Number(pace), lt2_hr: null, lt2_pace_sec_km: null, confidence: 0.9 }));
    const { container } = render(<ThresholdTrendsChart history={history} />);
    const july = () => container.querySelector('circle[aria-label^="LT1 2026-07-01:"]')!.getAttribute('aria-label');
    fireEvent.click(screen.getByText('3 Months'));
    const shortRange = july();
    expect(shortRange).not.toBe('LT1 2026-07-01: 360');
    fireEvent.click(screen.getByText('12M'));
    expect(july()).toBe(shortRange);
    fireEvent.click(screen.getByText('Show individual runs'));
    expect(july()).toBe('LT1 2026-07-01: 360');
  });
});
