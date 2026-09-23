import { describe, expect, it } from 'vitest';
import { selectNotableRunComparison } from '../../src/frontend/utils/coachComparison.js';

const similarRun = {
  id: 'prior',
  startTime: '2026-09-21 07:00:00',
  distanceKm: 12.2,
  paceSecKm: 387,
  heartRate: 140,
  aboveCeilingPct: 0
};

describe('last similar run observation', () => {
  it('skips unchanged intensity and highlights a meaningful pace difference at similar heart rate', () => {
    expect(selectNotableRunComparison({
      lastSimilarRun: similarRun,
      currentAboveCeilingPct: 0,
      currentPaceSecKm: 369,
      currentHeartRate: 142
    })).toMatchObject({ kind: 'pace', secondsPerKm: 18, direction: 'faster' });
  });

  it('stays silent when both intensity and effort are similar', () => {
    expect(selectNotableRunComparison({
      lastSimilarRun: similarRun,
      currentAboveCeilingPct: 0,
      currentPaceSecKm: 384,
      currentHeartRate: 141
    })).toBeNull();
  });

  it('highlights a meaningful intensity change', () => {
    expect(selectNotableRunComparison({
      lastSimilarRun: similarRun,
      currentAboveCeilingPct: 7.5,
      currentPaceSecKm: 384,
      currentHeartRate: 141
    })).toMatchObject({ kind: 'intensity', previous: 0, current: 7.5 });
  });
});
