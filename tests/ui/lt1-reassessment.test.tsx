// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Lt1Reassessment } from '../../src/frontend/components/Lt1Reassessment.js';

afterEach(cleanup);
describe('LT1 reassessment copy', () => {
  it('distinguishes an older reference from a recent uncorroborated higher effort', () => {
    render(<Lt1Reassessment assessment={{ assessedRunCount: 18, usableRunCount: 12, latestEvidenceDate: '2026-10-03',
      reference: { activityId: 'reference', date: '2026-08-15', hr: 157, paceSecKm: 348, runningSeconds: 2400,
        decouplingPct: 2, basis: 'run_walk', supportCount: 4, supportingActivityIds: ['a', 'b', 'c', 'd'], stale: true },
      candidate: { activityId: 'mp', date: '2026-10-03', hr: 165, paceSecKm: 329, runningSeconds: 3480,
        decouplingPct: 4, basis: 'continuous' } }} />);
    expect(screen.getByRole('heading', { name: 'LT1 Reassessment' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Stable-running reference' }).closest('article')?.textContent).toContain('157 bpm at 5:48/km');
    expect(screen.getByRole('heading', { name: 'Stable-running reference' }).closest('article')?.textContent).toContain('4 supporting efforts');
    expect(screen.getByRole('heading', { name: 'Stable-running reference' }).closest('article')?.textContent).toContain('older reference retained');
    expect(screen.getByRole('heading', { name: 'Higher effort awaiting corroboration' }).closest('article')?.textContent).toContain('165 bpm at 5:29/km');
    expect(screen.getByText('Latest evidence: Oct 3, 2026')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Stable-running reference' }).closest('article')?.textContent).toContain('Aug 15, 2026');
    expect(screen.getByText('How this estimate is updated').closest('details')?.open).toBe(false);
    expect(screen.getByText(/Corroborated running evidence updates/).textContent).toContain('LT1 remains a workout estimate');
  });
});
