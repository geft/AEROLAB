import { describe, it, expect } from 'vitest';
import { calculateRacePredictions, formatDuration, formatPace } from '../../src/backend/physiology/predictions';

describe('Race Time Predictions & VDOT', () => {
  it('calculates 5k, 10k, half, and marathon predictions from threshold pace', () => {
    // 4:10/km threshold pace = 250 sec/km
    const result = calculateRacePredictions(250, 310);

    expect(result.vo2Max).toBeGreaterThan(45);
    expect(result.predictions).toHaveLength(4);

    const fiveK = result.predictions.find(p => p.distanceName === '5K');
    expect(fiveK).toBeDefined();
    expect(fiveK?.paceSecKm).toBeLessThan(250); // faster than threshold

    const marathon = result.predictions.find(p => p.distanceName === 'Marathon');
    expect(marathon).toBeDefined();
    expect(marathon?.paceSecKm).toBeGreaterThan(250); // slower than threshold
  });

  it('formats duration correctly', () => {
    expect(formatDuration(3665)).toBe('1:01:05');
    expect(formatDuration(1245)).toBe('20:45');
  });

  it('formats pace correctly', () => {
    expect(formatPace(315)).toBe('5:15/km');
    expect(formatPace(240)).toBe('4:00/km');
  });
});
