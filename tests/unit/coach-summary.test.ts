import { describe, it, expect } from 'vitest';
import { generateCoachSummary } from '../../src/backend/physiology/coach-summary.js';

describe('AI Coach Summary Unit Tests', () => {
  it('shows elevated NEA haze as a caution alongside weather context', () => {
    const summary = generateCoachSummary({
      runType: 'long_run', distanceKm: 18, durationMin: 105, avgPaceSecKm: 360,
      avgHr: 146, maxHr: 160, cadence: 175, decouplingPct: 7.5,
      efficiencyFactor: 1.15, avgTemp: 30, groundContactTime: 250,
      weatherTempC: 31, weatherCondition: 'Moderate rain', weatherHumidityPct: 85,
      weatherPm25: 96, weatherPm25Source: 'nea-sg', recentAverageWeatherTempC: 28
    });

    const weatherInsight = summary.keyInsights.find(i => i.startsWith('Microclimate Weather'));
    expect(weatherInsight).toContain('Precipitation conditions (Moderate rain)');
    expect(weatherInsight).toContain('Warmer than your recent fetched-run average (28.0°C)');
    expect(weatherInsight).not.toContain('PM2.5');

    const airQualityInsight = summary.keyInsights.find(i => i.startsWith('Air Quality Watch'));
    expect(airQualityInsight).toContain('NEA\'s nearest regional monitor measured 96 µg/m³ PM2.5');
    expect(airQualityInsight).toContain('Elevated 1-hour band');
    expect(airQualityInsight).toContain('Haze may have added breathing strain');
    expect(summary.insightTones[summary.keyInsights.indexOf(airQualityInsight!)]).toBe('caution');
  });

  it('keeps a high modeled PM2.5 estimate visible as a caveated caution', () => {
    const summary = generateCoachSummary({
      runType: 'easy_base', distanceKm: 8, durationMin: 50, avgPaceSecKm: 360,
      avgHr: 140, maxHr: 155, cadence: 176, decouplingPct: 3,
      efficiencyFactor: 1.2, avgTemp: 26, groundContactTime: 250, weatherTempC: 24,
      weatherPm25: 62.4, weatherPm25Source: 'open-meteo'
    });

    const airQualityInsight = summary.keyInsights.find(i => i.startsWith('Air Quality Estimate'));
    expect(airQualityInsight).toContain('62.4 µg/m³');
    expect(airQualityInsight).toContain('not a local monitor reading');
    expect(summary.insightTones[summary.keyInsights.indexOf(airQualityInsight!)]).toBe('caution');
  });

  it('generates high score and positive insights for disciplined aerobic run', () => {
    const summary = generateCoachSummary({
      runType: 'easy_base',
      distanceKm: 8.5,
      durationMin: 50,
      avgPaceSecKm: 350,
      avgHr: 135,
      maxHr: 148,
      cadence: 178,
      decouplingPct: 1.4,
      efficiencyFactor: 1.25,
      avgTemp: 27,
      groundContactTime: 245,
      elevationGainM: 10
    });

    // An easy run is graded on intensity control plus the integrity gate:
    // Steady HR 135 vs a 143 bpm LT1 ceiling => full intensity marks.
    expect(summary.effectivenessScore).toBe(98);
    expect(summary.headline).toBe('Near-Perfect Aerobic Base Execution');
    expect(summary.rubricFamily).toBe('aerobic');
    expect(summary.rubricCoveragePct).toBe(85); // intensity only (no pause telemetry)
    expect(summary.scoreBreakdown.map(f => f.category)).toEqual(['Aerobic Intensity']);
    expect(summary.keyInsights).toHaveLength(4); // decoupling, cadence, GCT, rubric coverage
    expect(summary.keyInsights[0]).toContain('Superb cardiovascular stability');
    expect(summary.keyInsights[1]).toContain('Cadence was right in the sweet spot (178 spm)');
    expect(summary.keyInsights[2]).toContain('Swift ground reaction: 245 ms stance time');
    expect(summary.keyInsights[3]).toContain('Rubric Coverage: 85%');
    expect(summary.recommendation).toContain('absorbing current volume smoothly');
  });

  it('widens the cardiac-drift target for heat and duration instead of grading against 1.5%', () => {
    const cool = generateCoachSummary({
      runType: 'long_run', distanceKm: 14, durationMin: 80, avgPaceSecKm: 345, avgHr: 140,
      maxHr: 152, cadence: 176, decouplingPct: 4.4, efficiencyFactor: 1.2, avgTemp: 16, weatherTempC: 16,
      groundContactTime: 248, elevationGainM: 20
    });
    const hotLong = generateCoachSummary({
      runType: 'long_run', distanceKm: 21, durationMin: 130, avgPaceSecKm: 371, avgHr: 144,
      maxHr: 158, cadence: 176, decouplingPct: 4.4, efficiencyFactor: 1.2, avgTemp: 31, weatherTempC: 31,
      groundContactTime: 248, elevationGainM: 20
    });

    // Drift is no longer a scoring failure on an easy run: intensity is. Both of
    // these runs keep the ceiling, so what changes is only the reported target.
    const coolInsight = cool.keyInsights.find(i => i.startsWith('Solid aerobic discipline') || i.startsWith('Noticeable cardiac drift'));
    const hotInsight = hotLong.keyInsights.find(i => i.startsWith('Superb cardiovascular stability'));
    expect(coolInsight).toBeDefined();
    expect(coolInsight).toContain('1.74%'); // no heat allowance at 16 °C
    expect(hotInsight).toBeDefined();
    expect(hotInsight).toContain('4.44% target'); // 31 °C over 130 min
  });

  it('does not treat a hot Garmin wrist reading as verified ambient heat', () => {
    const base = {
      runType: 'long_run', distanceKm: 18, durationMin: 110, avgPaceSecKm: 360,
      avgHr: 140, maxHr: 155, cadence: 175, decouplingPct: 3.5,
      efficiencyFactor: 1.2, groundContactTime: 250, elevationGainM: 10
    };
    const wristOnly = generateCoachSummary({ ...base, avgTemp: 35 });
    const noTemperature = generateCoachSummary({ ...base, avgTemp: null });
    expect(wristOnly.effectivenessScore).toBe(noTemperature.effectivenessScore);
    expect(wristOnly.keyInsights.find(i => i.startsWith('Superb cardiovascular')))
      .toEqual(noTemperature.keyInsights.find(i => i.startsWith('Superb cardiovascular')));
    expect(wristOnly.keyInsights.some(i => i.includes('Microclimate Weather'))).toBe(false);
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

    // An easy run only fails on intensity: 11 of 85 points lost for sitting
    // above a 143 bpm LT1 ceiling, then capped at Bronze by the tempo rule.
    expect(summary.effectivenessScore).toBe(40);
    expect(summary.stars).toBe(1);
    expect(summary.scoreBreakdown).toBeDefined();
    const intensityFactor = summary.scoreBreakdown.find(f => f.category === 'Aerobic Intensity');
    expect(intensityFactor).toBeDefined();
    expect(intensityFactor?.maxPoints).toBe(85);
    expect(intensityFactor?.points).toBeLessThan(85 * 0.7);
    expect(intensityFactor?.isFocus).toBe(true);
    expect(summary.focusAdvice).toContain('Biggest Lever');
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
      avgTemp: 36, // Wrist reading is not an ambient measurement.
      weatherTempC: 32,
      groundContactTime: 255,
      elevationGainM: 28 // Significant elevation gain
    });

    const heatInsight = summary.keyInsights.find(i => i.includes('Microclimate Weather'));
    expect(heatInsight).toBeDefined();
    expect(heatInsight).toContain('32°C ambient');
    expect(heatInsight).toContain('Garmin watch sensor: 36°C');

    const elevationInsight = summary.keyInsights.find(i => i.includes('Elevation & Ramps'));
    expect(elevationInsight).toBeDefined();
    expect(elevationInsight).toContain('+28m ascent');
  });

  it('applies cadence warning and clamps the weighted score within [40, 98]', () => {
    // Very poor run: heavy drift, slow cadence, accidental tempo
    const lowSummary = generateCoachSummary({
      runType: 'easy_base',
      distanceKm: 5,
      durationMin: 35,
      avgPaceSecKm: 420,
      avgHr: 155,
      maxHr: 172,
      cadence: 158, // below the turnover sweet spot
      decouplingPct: 14.5, // far beyond the 8% zero-drift-credit line
      efficiencyFactor: 0.9,
      avgTemp: 26,
      groundContactTime: 310
    });

    // Every measurable aerobic factor scores zero => clamped to the 40-point floor (Bronze)
    expect(lowSummary.effectivenessScore).toBe(40);
    expect(lowSummary.stars).toBe(1);
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
    // A perfect rubric reading is still capped at 98
    expect(highSummary.effectivenessScore).toBe(98);
    expect(highSummary.scoreBreakdown.every(f => f.points === f.maxPoints)).toBe(true);
    expect(highSummary.focusAdvice).toBeNull();
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

    expect(thresholdSummary.headline).toBe('Threshold Zone Not Verified');
    expect(thresholdSummary.verdict).toBe('insufficient_evidence');
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
    const stopInsight = summary.keyInsights.find(i => i.startsWith('Stop & Walk Isolation'));
    expect(stopInsight).toBeDefined();
    expect(stopInsight).toContain('3 stationary stops (2m 0s idle)');
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

    // Score should be high (>= 95 / 100, which is 3 stars Gold)
    expect(summary.effectivenessScore).toBeGreaterThanOrEqual(95);
    expect(summary.rating5).toBeGreaterThanOrEqual(4.8);
    expect(summary.stars).toBe(3);
    expect(summary.headline).toBe('Masterful VO2 Max Interval Execution');

    // Should include rep consistency and target stimulus insights
    const pacingInsight = summary.keyInsights.find(i => i.includes('Rep Consistency'));
    expect(pacingInsight).toBeDefined();

    const stimulusInsight = summary.keyInsights.find(i => i.includes('Target VO2 Stimulus'));
    expect(stimulusInsight).toBeDefined();
    expect(stimulusInsight).toContain('193 bpm');

    const recoveryInsight = summary.keyInsights.find(i => i.startsWith('Recovery Intent:') || i.startsWith('Recovery Rate:'));
    expect(recoveryInsight).toBeDefined();

    // No decoupling penalty insight
    const decouplingInsight = summary.keyInsights.find(i => i.includes('cardiac drift detected'));
    expect(decouplingInsight).toBeUndefined();
  });

  it('downgrades race execution from 3 stars to 2 stars for erratic split pacing and aggressive early surge', () => {
    const summary = generateCoachSummary({
      runType: 'race',
      distanceKm: 8.9,
      durationMin: 56,
      avgPaceSecKm: 378,
      avgHr: 160,
      maxHr: 200,
      cadence: 183,
      decouplingPct: null,
      efficiencyFactor: 1.15,
      avgTemp: 29,
      groundContactTime: 231,
      maxHeartRate: 203,
      intervals: [
        { intervalIndex: 1, type: 'recovery', startSeconds: 0, durationSeconds: 1477 },
        { intervalIndex: 2, type: 'work', startSeconds: 1477, durationSeconds: 1318, avgPaceSecKm: 273, avgHeartRate: 188 },
        { intervalIndex: 3, type: 'recovery', startSeconds: 2795, durationSeconds: 571 }
      ],
      splits: [
        { split_index: 1, duration_seconds: 368, avg_pace_sec_km: 369 },
        { split_index: 2, duration_seconds: 413, avg_pace_sec_km: 366 },
        { split_index: 3, duration_seconds: 572, avg_pace_sec_km: 560 },
        { split_index: 4, duration_seconds: 304, avg_pace_sec_km: 333 },
        // Race splits (4:25 opening km followed by 15s drop to 4:40)
        { split_index: 5, duration_seconds: 265, avg_pace_sec_km: 265 },
        { split_index: 6, duration_seconds: 280, avg_pace_sec_km: 280 },
        { split_index: 7, duration_seconds: 278, avg_pace_sec_km: 278 },
        { split_index: 8, duration_seconds: 275, avg_pace_sec_km: 275 },
        { split_index: 9, duration_seconds: 580, avg_pace_sec_km: 580 }
      ]
    });

    // Score: 85 (base) + 4 (cadence 183) - 10 (early surge 4:25 vs 4:40) = 79 (2 Stars / Silver)
    expect(summary.stars).toBe(2);
    expect(summary.effectivenessScore).toBeLessThan(85);
    expect(summary.effectivenessScore).toBeGreaterThanOrEqual(70);
    expect(summary.headline).toContain('Erratic Pacing');
    const surgeAlert = summary.keyInsights.find(i => i.includes('Race Pacing Alert'));
    expect(surgeAlert).toBeDefined();
    expect(surgeAlert).toContain('Opened too fast');
  });

  it('awards 3 stars for disciplined, even-split race pacing', () => {
    const summary = generateCoachSummary({
      runType: 'race',
      distanceKm: 5.0,
      durationMin: 22,
      avgPaceSecKm: 264,
      avgHr: 185,
      maxHr: 195,
      cadence: 182,
      decouplingPct: null,
      efficiencyFactor: 1.25,
      avgTemp: 25,
      groundContactTime: 220,
      maxHeartRate: 203,
      splits: [
        { split_index: 1, duration_seconds: 266, avg_pace_sec_km: 266 },
        { split_index: 2, duration_seconds: 265, avg_pace_sec_km: 265 },
        { split_index: 3, duration_seconds: 264, avg_pace_sec_km: 264 },
        { split_index: 4, duration_seconds: 263, avg_pace_sec_km: 263 },
        { split_index: 5, duration_seconds: 262, avg_pace_sec_km: 262 }
      ]
    });

    // Score: 85 (base) + 4 (cadence) + 6 (laser even pacing) = 95 (3 Stars / Gold)
    expect(summary.stars).toBe(3);
    expect(summary.effectivenessScore).toBeGreaterThanOrEqual(90);
    expect(summary.headline).toContain('Masterful Race Execution');
    const disciplineInsight = summary.keyInsights.find(i => i.includes('Masterful Race Pacing'));
    expect(disciplineInsight).toBeDefined();
  });
});
