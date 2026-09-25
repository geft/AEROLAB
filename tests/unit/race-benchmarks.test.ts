import { describe, expect, it } from 'vitest';
import { raceBenchmarkFor } from '../../src/frontend/utils/raceBenchmarks.js';

describe('offline race benchmarks', () => {
  it('compares a prediction to age and gender standards at every race distance', () => {
    for (const distance of ['5K', '10K', 'Half Marathon', 'Marathon']) {
      for (let age = 20; age <= 90; age += 5) {
        const male = raceBenchmarkFor(distance, 1500, age, 'Male');
        const female = raceBenchmarkFor(distance, 1500, age, 'Female');
        expect(male?.levels).toHaveLength(5);
        expect(female?.levels).toHaveLength(5);
        expect(male!.levels[2].timeSeconds).toBeLessThan(female!.levels[2].timeSeconds);
        expect(male!.levels.every((row, index) => index === 0 || row.timeSeconds < male!.levels[index - 1].timeSeconds)).toBe(true);
      }
    }
  });

  it('interpolates five-year age rows and assigns the highest achieved level', () => {
    const age40 = raceBenchmarkFor('5K', 1305, 40, 'Male')!;
    const age45 = raceBenchmarkFor('5K', 1305, 45, 'Male')!;
    const age42 = raceBenchmarkFor('5K', 1305, 42, 'Male')!;
    expect(age42.levels[2].timeSeconds).toBeGreaterThan(age40.levels[2].timeSeconds);
    expect(age42.levels[2].timeSeconds).toBeLessThan(age45.levels[2].timeSeconds);
    expect(age40.achievedLevel).toBe('intermediate');
    expect(raceBenchmarkFor('5K', 1110, 40, 'Male')?.achievedLevel).toBe('elite');
  });

  it('avoids inventing demographic comparisons when profile data is missing', () => {
    expect(raceBenchmarkFor('5K', 1305, null, 'Male')).toBeNull();
    expect(raceBenchmarkFor('5K', 1305, 40, 'Prefer not to say')).toBeNull();
    expect(raceBenchmarkFor('5K', 1305, 91, 'Female')).toBeNull();
    expect(raceBenchmarkFor('5K', 0, 40, 'Male')).toBeNull();
  });
});
