import { describe, it, expect } from 'vitest';
import { generateCoachSummary } from '../../src/backend/physiology/coach-summary.js';

describe('AI Coach Summary Unit Tests', () => {
  it('generates high score and positive insights for disciplined aerobic run', () => {
    const summary = generateCoachSummary({
      runType: 'easy_base',
      distanceKm: 8.5,
      durationMin: 50,
      avgPaceSecKm: 350,
      avgHr: 135,
      maxHr: 148,
      cadence: 178,
      decouplingPct: 1.8,
      efficiencyFactor: 1.25,
      avgTemp: 27,
      groundContactTime: 245,
      elevationGainM: 10
    });

    // Baseline 85 + 8 (drift < 3) + 4 (cadence 178) = 97
    expect(summary.effectivenessScore).toBe(97);
    expect(summary.headline).toBe('Near-Perfect Aerobic Base Execution');
    expect(summary.keyInsights).toHaveLength(3); // decoupling, cadence, GCT
    expect(summary.keyInsights[0]).toContain('Superb cardiovascular stability');
    expect(summary.keyInsights[1]).toContain('Cadence was right in the sweet spot (178 spm)');
    expect(summary.keyInsights[2]).toContain('Swift ground reaction: 245 ms stance time');
    expect(summary.recommendation).toContain('absorbing current volume smoothly');
  });

  it('detects accidental tempo / grey-zone drift on easy runs', () => {
    const summary = generateCoachSummary({
      runType: 'easy_base',
      distanceKm: 10,
      durationMin: 55,
      avgPaceSecKm: 330,
      avgHr: 149, // Exceeds pure Zone 2 ceiling
      maxHr: 162,
      cadence: 168,
      decouplingPct: 7.2, // High drift
      efficiencyFactor: 1.15,
      avgTemp: 29,
      groundContactTime: 270,
      elevationGainM: 8
    });

    // Score: 85 - 8 (drift > 5) - 6 (accidental tempo) = 71
    expect(summary.effectivenessScore).toBe(71);
    expect(summary.headline).toBe('Unintentional Tempo / Drifted Aerobic Run');
    const pacingAlert = summary.keyInsights.find(i => i.startsWith('Pacing Alert'));
    expect(pacingAlert).toBeDefined();
    expect(pacingAlert).toContain('149 bpm avg');
    expect(summary.recommendation).toContain('slow your initial kilometer pace by 15-20 sec/km');
  });

  it('identifies thermal burden and isolates ramp/elevation walking', () => {
    const summary = generateCoachSummary({
      runType: 'long_run',
      distanceKm: 16,
      durationMin: 95,
      avgPaceSecKm: 360,
      avgHr: 140,
      maxHr: 154,
      cadence: 175,
      decouplingPct: 3.5, // 3-5% = +4
      efficiencyFactor: 1.20,
      avgTemp: 32, // High heat >= 30
      groundContactTime: 255,
      elevationGainM: 28 // Significant elevation gain
    });

    const heatInsight = summary.keyInsights.find(i => i.includes('hot conditions'));
    expect(heatInsight).toBeDefined();
    expect(heatInsight).toContain('32°C');

    const elevationInsight = summary.keyInsights.find(i => i.includes('Elevation & Ramps'));
    expect(elevationInsight).toBeDefined();
    expect(elevationInsight).toContain('+28m ascent');
  });

  it('applies cadence warning and clamps score within [55, 98]', () => {
    // Very poor run: heavy drift, slow cadence, accidental tempo
    const lowSummary = generateCoachSummary({
      runType: 'easy_base',
      distanceKm: 5,
      durationMin: 35,
      avgPaceSecKm: 420,
      avgHr: 155,
      maxHr: 172,
      cadence: 158, // < 165: -3
      decouplingPct: 14.5, // > 5: -8
      efficiencyFactor: 0.9,
      avgTemp: 26,
      groundContactTime: 310
    });

    // 85 - 8 - 3 - 6 = 68 (not below 55, but penalized)
    expect(lowSummary.effectivenessScore).toBe(68);
    const cadenceInsight = lowSummary.keyInsights.find(i => i.includes('Increasing turnover'));
    expect(cadenceInsight).toBeDefined();

    // Check high clamping
    const highSummary = generateCoachSummary({
      runType: 'easy_base',
      distanceKm: 12,
      durationMin: 65,
      avgPaceSecKm: 320,
      avgHr: 130,
      maxHr: 142,
      cadence: 180,
      decouplingPct: 1.0,
      efficiencyFactor: 1.35,
      avgTemp: 24,
      groundContactTime: 230
    });
    // Score would be 85 + 8 + 4 = 97 <= 98
    expect(highSummary.effectivenessScore).toBeLessThanOrEqual(98);
  });

  it('customizes headline and advice for threshold and VO2 interval workouts', () => {
    const thresholdSummary = generateCoachSummary({
      runType: 'threshold_lt2',
      distanceKm: 10,
      durationMin: 45,
      avgPaceSecKm: 270,
      avgHr: 168,
      maxHr: 176,
      cadence: 182,
      decouplingPct: null,
      efficiencyFactor: 1.45,
      avgTemp: 28,
      groundContactTime: 235
    });

    expect(thresholdSummary.headline).toBe('High-Quality Lactate Clearance Stimulus');
    expect(thresholdSummary.recommendation).toContain('48 hours of recovery');

    const vo2Summary = generateCoachSummary({
      runType: 'intervals_vo2',
      distanceKm: 8,
      durationMin: 40,
      avgPaceSecKm: 240,
      avgHr: 172,
      maxHr: 184,
      cadence: 190,
      decouplingPct: null,
      efficiencyFactor: 1.55,
      avgTemp: 28,
      groundContactTime: 215
    });

    expect(vo2Summary.headline).toBe('Sharp High-Velocity Neuromuscular Stimulus');
    expect(vo2Summary.recommendation).toContain('fast-twitch muscle fibers');
  });

  it('isolates traffic stops and walk breaks from steady state running, preventing cadence and pace distortions', () => {
    // Garmin raw cadence is 156 (skewed by stops), but steady cadence was 178!
    const summary = generateCoachSummary({
      runType: 'easy_base',
      distanceKm: 8.5,
      durationMin: 55,
      avgPaceSecKm: 420, // raw Garmin pace diluted by stops (7:00/km)
      avgHr: 130,        // raw Garmin avg HR
      maxHr: 144,
      cadence: 156,      // raw Garmin cadence (skewed low by stops)
      decouplingPct: 2.0,
      efficiencyFactor: 1.25,
      avgTemp: 28,
      groundContactTime: 310, // raw GCT diluted by walking
      // Steady state overrides
      steadyPaceSecKm: 345,   // true running pace 5:45/km
      steadyHr: 134,
      steadyCadence: 178,     // true running cadence
      steadyStanceTime: 250,  // true running GCT
      pauseBreakdown: {
        stopCount: 3,
        stopDurationSeconds: 120, // 2m 0s idle
        walkCount: 2,
        walkDurationSeconds: 180, // 3m 0s walk
        walkDistanceMeters: 220,
        steadyRunningDurationSeconds: 2700,
        steadyRunningDistanceMeters: 7800,
        steadyPaceSecKm: 345,
        steadyHeartRate: 134,
        steadyCadence: 178,
        steadyStanceTimeMs: 250,
        steadyVertOscMm: 82
      }
    });

    // Check pause isolation insight
    const stopInsight = summary.keyInsights.find(i => i.startsWith('Traffic & Walk Break Isolation'));
    expect(stopInsight).toBeDefined();
    expect(stopInsight).toContain('3 stationary/traffic stops (2m 0s idle)');
    expect(stopInsight).toContain('2 walk breaks (3m 0s, 220m)');
    expect(stopInsight).toContain('5:45/km at 134 bpm (178 spm)');

    // Cadence should use steadyCadence (178), NOT raw 156
    const cadenceInsight = summary.keyInsights.find(i => i.includes('sweet spot (178 spm)'));
    expect(cadenceInsight).toBeDefined();

    // Stance time should use steadyStanceTime (250 ms), NOT raw 310
    const gctInsight = summary.keyInsights.find(i => i.includes('250 ms stance time'));
    expect(gctInsight).toBeDefined();
  });

  it('evaluates VO2 Max intervals with high execution score, zero drift penalty, and recovery drop recognition', () => {
    const summary = generateCoachSummary({
      runType: 'intervals_vo2',
      distanceKm: 11.8,
      durationMin: 72,
      avgPaceSecKm: 307,
      avgHr: 165,
      maxHr: 193,
      cadence: 186,
      decouplingPct: 11.8, // High drift that should NOT penalize intervals
      efficiencyFactor: 1.25,
      avgTemp: 30,
      groundContactTime: 226,
      maxHeartRate: 203,
      intervals: [
        { intervalIndex: 1, type: 'recovery', durationSeconds: 1138, avgPaceSecKm: 377, avgHeartRate: 142, maxHeartRate: 158 },
        { intervalIndex: 2, type: 'work', durationSeconds: 237, distanceMeters: 979, avgPaceSecKm: 242, avgHeartRate: 178, maxHeartRate: 193 },
        { intervalIndex: 3, type: 'recovery', durationSeconds: 140, distanceMeters: 185, avgPaceSecKm: 720, avgHeartRate: 153, maxHeartRate: 191, hrDrop: 62 },
        { intervalIndex: 4, type: 'work', durationSeconds: 239, distanceMeters: 969, avgPaceSecKm: 245, avgHeartRate: 179, maxHeartRate: 191 },
        { intervalIndex: 5, type: 'recovery', durationSeconds: 141, distanceMeters: 190, avgPaceSecKm: 707, avgHeartRate: 154, maxHeartRate: 189, hrDrop: 56 },
        { intervalIndex: 6, type: 'work', durationSeconds: 242, distanceMeters: 971, avgPaceSecKm: 249, avgHeartRate: 181, maxHeartRate: 192 },
        { intervalIndex: 7, type: 'recovery', durationSeconds: 141, distanceMeters: 204, avgPaceSecKm: 668, avgHeartRate: 158, maxHeartRate: 191, hrDrop: 55 },
        { intervalIndex: 8, type: 'work', durationSeconds: 239, distanceMeters: 963, avgPaceSecKm: 251, avgHeartRate: 183, maxHeartRate: 192 },
        { intervalIndex: 9, type: 'recovery', durationSeconds: 1395, distanceMeters: 2815, avgPaceSecKm: 419, avgHeartRate: 156, maxHeartRate: 193 }
      ]
    });

    // Score should be high (>= 95 / 100, which is 5 stars)
    expect(summary.effectivenessScore).toBeGreaterThanOrEqual(95);
    expect(summary.rating5).toBeGreaterThanOrEqual(4.8);
    expect(summary.stars).toBe(5);
    expect(summary.headline).toBe('Masterful VO2 Max Interval Execution');

    // Should include pacing consistency and target stimulus insights
    const pacingInsight = summary.keyInsights.find(i => i.includes('Pacing Consistency'));
    expect(pacingInsight).toBeDefined();

    const stimulusInsight = summary.keyInsights.find(i => i.includes('Target VO2 Stimulus'));
    expect(stimulusInsight).toBeDefined();
    expect(stimulusInsight).toContain('193 bpm');

    const recoveryInsight = summary.keyInsights.find(i => i.includes('Rapid Cardiovascular Recovery'));
    expect(recoveryInsight).toBeDefined();

    // No decoupling penalty insight
    const decouplingInsight = summary.keyInsights.find(i => i.includes('cardiac drift detected'));
    expect(decouplingInsight).toBeUndefined();
  });
});


