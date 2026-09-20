import { describe, it, expect } from 'vitest';
import { findAerobicCruisingBlock, SplitRow } from '../../src/backend/physiology/threshold-tracker.js';

function splits(hrs: number[], pace = 360): SplitRow[] {
  return hrs.map((hr, i) => ({ split_index: i + 1, distance_meters: 1000,
    duration_seconds: pace, avg_pace_sec_km: pace, avg_heart_rate: hr, elevation_change_m: 0 }));
}

describe('LT1 accumulated drift protection', () => {
  it('does not turn a steady late plateau into threshold evidence', () => {
    const rows = splits([...Array(15).fill(140), ...Array(6).fill(156)], 412);
    expect(findAerobicCruisingBlock(rows, 162, 152)).toBeNull();
  });
  it('rejects accumulated drift even if the late plateau is inside the first hour', () => {
    const rows = splits([...Array(6).fill(140), ...Array(4).fill(150)]);
    expect(findAerobicCruisingBlock(rows, 156, 149)).toBeNull();
  });
  it('still accepts steady early evidence from a long run', () => {
    const rows = splits([...Array(10).fill(150), ...Array(10).fill(160)]);
    const block = findAerobicCruisingBlock(rows, 162, 148);
    expect(block?.avgHr).toBe(150);
    expect(block?.endSplit).toBeLessThanOrEqual(10);
  });
  it('does not restart elapsed time after missing or excluded splits', () => {
    const rows = splits(Array(20).fill(150));
    rows[2].elevation_change_m = 100;
    const block = findAerobicCruisingBlock(rows, 156, 148);
    expect(block?.endSplit).toBeLessThanOrEqual(10);
    expect(findAerobicCruisingBlock(rows.slice(10), 156, 148)).toBeNull();
  });
});
