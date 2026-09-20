import { describe, it, expect } from 'vitest';
import { generateCoachSummary } from '../../src/backend/physiology/coach-summary.js';
import type { CoachInsightTone } from '../../src/backend/physiology/coach-insight.js';

const VALID_TONES: CoachInsightTone[] = ['positive', 'neutral', 'caution', 'negative'];

/** Per-second telemetry, so the rubric can audit time above the LT1 ceiling. */
const records = (segments: Array<{ hr: number; sec: number }>) => {
  const out: any[] = [];
  let t = 0;
  for (const seg of segments) {
    for (let i = 0; i < seg.sec; i++) {
      out.push({ elapsed_seconds: t, heart_rate: seg.hr, cadence: 172, speed_mps: 3.2, altitude_m: 20 });
      t += 1;
    }
  }
  return out;
};

/** The insight starting with `prefix`, paired with the tone written for it. */
const toneOf = (summary: any, prefix: string): CoachInsightTone | undefined => {
  const idx = summary.keyInsights.findIndex((i: string) => i.startsWith(prefix));
  return idx === -1 ? undefined : summary.insightTones[idx];
};

const aerobicBase = (overrides: Record<string, unknown> = {}) => generateCoachSummary({
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
  elevationGainM: 10,
  ...overrides
} as any);

describe('Coach debrief insight tones', () => {
  it('writes exactly one tone per insight, index-for-index', () => {
    const summaries = [
      aerobicBase(),
      aerobicBase({ runType: 'easy_base', avgHr: 149, decouplingPct: 7.2, cadence: 168 }),
      aerobicBase({ isFailedWorkout: true, runType: 'intervals_vo2' }),
      generateCoachSummary({
        runType: 'race', distanceKm: 21.1, durationMin: 95, avgPaceSecKm: 270, avgHr: 172,
        maxHr: 190, cadence: 180, decouplingPct: null, efficiencyFactor: 1.3, avgTemp: 28,
        groundContactTime: 240
      } as any)
    ];

    for (const summary of summaries) {
      expect(summary.insightTones).toHaveLength(summary.keyInsights.length);
      for (const tone of summary.insightTones) {
        expect(VALID_TONES).toContain(tone);
      }
    }
  });

  it('reads strengths as positive and methodology as neutral', () => {
    const summary = aerobicBase();

    expect(toneOf(summary, 'Superb cardiovascular stability')).toBe('positive');
    expect(toneOf(summary, 'Cadence was right in the sweet spot')).toBe('positive');
    expect(toneOf(summary, 'Swift ground reaction')).toBe('positive');
    expect(toneOf(summary, 'Rubric Coverage')).toBe('neutral');
  });

  it('marks drifted aerobic sessions and slow cadence as watches', () => {
    // 160 spm sits below the 165-172 sweet-spot floor, so the cadence line is a watch.
    const summary = aerobicBase({ avgHr: 149, maxHr: 162, decouplingPct: 7.2, cadence: 160, groundContactTime: 270 });

    expect(toneOf(summary, 'Pacing Alert')).toBe('negative');
    expect(toneOf(summary, 'Noticeable cardiac drift')).toBe('caution');
    expect(toneOf(summary, 'Steady running cadence averaged')).toBe('caution');
  });

  it('escalates sustained over-intensity to a fix', () => {
    const summary = generateCoachSummary({
      runType: 'easy_base',
      distanceKm: 9,
      durationMin: 52,
      avgPaceSecKm: 340,
      avgHr: 148,
      maxHr: 176,
      cadence: 174,
      decouplingPct: 5.0,
      efficiencyFactor: 1.18,
      avgTemp: 28,
      groundContactTime: 250,
      lt1Hr: 153,
      lt2Hr: 177,
      maxHeartRate: 203,
      steadyPaceSecKm: 340,
      steadyHr: 148,
      steadyCadence: 174,
      steadyStanceTime: 250,
      // 40% of running time above the 153 bpm ceiling: a tempo in an easy-day label
      records: records([{ hr: 176, sec: 400 }, { hr: 130, sec: 600 }])
    } as any);

    expect(toneOf(summary, 'Over-Intensity')).toBe('negative');
  });

  it('rewards a ceiling-respecting easy run', () => {
    const summary = generateCoachSummary({
      runType: 'easy_base',
      distanceKm: 9,
      durationMin: 52,
      avgPaceSecKm: 348,
      avgHr: 136,
      maxHr: 150,
      cadence: 178,
      decouplingPct: 2.0,
      efficiencyFactor: 1.24,
      avgTemp: 27,
      groundContactTime: 245,
      lt1Hr: 153,
      lt2Hr: 177,
      maxHeartRate: 203,
      steadyPaceSecKm: 348,
      steadyHr: 136,
      steadyCadence: 178,
      steadyStanceTime: 245,
      records: records([{ hr: 136, sec: 900 }, { hr: 130, sec: 900 }])
    } as any);

    expect(toneOf(summary, 'Aerobic Intensity Discipline')).toBe('positive');
  });

  it('classes an aborted quality session as a fix and its structure as context', () => {
    const rep = (hr: number) => ({ type: 'work', duration_seconds: 900, avg_heart_rate: hr, max_heart_rate: hr + 6, avg_pace_sec_km: 250 });
    const summary = generateCoachSummary({
      runType: 'threshold_lt2',
      distanceKm: 10,
      durationMin: 50,
      avgPaceSecKm: 300,
      avgHr: 168,
      maxHr: 180,
      cadence: 178,
      decouplingPct: null,
      efficiencyFactor: 1.2,
      avgTemp: 29,
      groundContactTime: 245,
      isFailedWorkout: true,
      lt1Hr: 153,
      lt2Hr: 177,
      maxHeartRate: 203,
      intervals: [rep(170), { type: 'recovery', duration_seconds: 120, hr_drop: 30 }, rep(170), rep(170)]
    } as any);

    expect(toneOf(summary, '⚠️ Incomplete / Aborted')).toBe('negative');
    expect(toneOf(summary, 'Exceptional Rep Consistency')).toBe('positive');
    expect(toneOf(summary, 'Set Profile')).toBe('neutral');
  });
});
