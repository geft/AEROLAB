import { describe, expect, it } from 'vitest';
import { hasHills, sessionTags } from '../../src/shared/session-tags.js';
import { analyzeWorkout, prepareAnalysisContext } from '../../src/backend/application/analysis/analyze-workout.js';
import { workoutTrace } from '../fixtures/workout-trace.js';
import { translateTag } from '../../src/frontend/i18n/tagTranslator.js';
import { en } from '../../src/frontend/i18n/en.js';
import { zh } from '../../src/frontend/i18n/zh.js';

describe('Hills terrain tag', () => {
  it.each([
    { distance_meters: 5000, elevation_gain_m: 100, elevation_loss_m: 100 },
    { distance_meters: 5000, elevation_gain_m: 150, elevation_loss_m: 0 },
    { distance_meters: 5000, elevation_gain_m: null, elevation_loss_m: 150 }
  ])('detects substantial rolling, uphill and downhill routes: %j', evidence => {
    expect(hasHills(evidence)).toBe(true);
    expect(sessionTags('tempo', [], evidence)).toEqual(['Tempo', 'Hills']);
    expect(sessionTags('easy_base', ['Strides'], evidence)).toEqual(['Easy Base', 'Strides', 'Hills']);
  });

  it.each([
    { distance_meters: 6051.37, elevation_gain_m: 31, elevation_loss_m: 42 }, // Highest vertical density in current history.
    { distance_meters: 1000, elevation_gain_m: 10, elevation_loss_m: 10 }, // Cycling ramp.
    { distance_meters: 1000, elevation_gain_m: 24, elevation_loss_m: 25 }, // Below total vertical floor.
    { distance_meters: 5000, elevation_gain_m: 74, elevation_loss_m: 75 }, // Below route density floor.
    { distance_meters: 20000, elevation_gain_m: 100, elevation_loss_m: 100 }, // Long, predominantly flat route.
    { distance_meters: 5000 },
    { distance_meters: 0, elevation_gain_m: 100 },
    { distance_meters: NaN, elevation_gain_m: 100 },
    { distance_meters: 5000, elevation_gain_m: NaN },
    { distance_meters: 5000, elevation_gain_m: -100, elevation_loss_m: 300 }
  ])('does not label ramps, predominantly flat routes or invalid evidence: %j', evidence => {
    expect(hasHills(evidence)).toBe(false);
    expect(sessionTags('easy_base', ['Hills'], evidence)).toEqual(['Easy Base']);
  });

  it('includes the boundary and derives import/replay tags from summary elevation', () => {
    expect(hasHills({ distance_meters: 1000, elevation_gain_m: 25, elevation_loss_m: 25 })).toBe(true);
    const trace = workoutTrace([{ seconds: 2400, hr: 135 }]);
    trace.metadata.totalAscentMeters = 180;
    trace.metadata.totalDescentMeters = 180;
    const input = { metadata: trace.metadata, rawRecords: trace.records,
      historicalProfile: { maxHr: 190, restingHr: 50, lt1Hr: 145, lt2Hr: 170 } };
    expect(analyzeWorkout(prepareAnalysisContext(input)).tags).toContain('Hills');
    trace.metadata.totalAscentMeters = 10;
    trace.metadata.totalDescentMeters = 10;
    expect(analyzeWorkout(prepareAnalysisContext(input)).tags).not.toContain('Hills');
  });

  it('translates the tag in both languages', () => {
    expect(translateTag('Hills', en)).toBe('Hills');
    expect(translateTag('Hills', zh)).toBe('坡地');
  });
});
