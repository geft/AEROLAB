import { describe, it, expect } from 'vitest';
import { generateCoachSummary } from '../../src/backend/physiology/coach-summary.js';

describe('Session-drift reporting in the debrief', () => {
  const rep = (hr: number, pace: number) => ({ type: 'work', duration_seconds: 900, avg_heart_rate: hr, max_heart_rate: hr + 6, avg_pace_sec_km: pace });

  it('says when a threshold session actually ran as a VO2 session', () => {
    const summary = generateCoachSummary({
      runType: 'threshold_lt2',
      distanceKm: 12,
      durationMin: 55,
      avgPaceSecKm: 280,
      avgHr: 190,
      maxHr: 200,
      cadence: 180,
      decouplingPct: null,
      efficiencyFactor: 1.2,
      avgTemp: 29,
      groundContactTime: 240,
      lt1Hr: 153,
      lt2Hr: 177,
      maxHeartRate: 203,
      intervals: [
        rep(192, 250),
        { type: 'recovery', duration_seconds: 120, hr_drop: 40 },
        rep(193, 250),
        { type: 'recovery', duration_seconds: 120, hr_drop: 38 },
        rep(193, 250)
      ]
    } as any);

    const drift = summary.keyInsights.find(i => i.startsWith('Session Drift:'));
    expect(drift).toBeDefined();
    expect(drift).toContain('ran as a VO2 session rather than threshold');
    expect(drift).toContain('177 bpm LT2 anchor'); // names the anchor it exceeded
    const intensity = summary.scoreBreakdown.find(f => f.category === 'Threshold Heart Rate')!;
    expect(intensity.label).toBe('Drifted Into VO2 Territory');
  });

  it('flags a threshold session that never reached its anchor', () => {
    const summary = generateCoachSummary({
      runType: 'threshold_lt2',
      distanceKm: 11,
      durationMin: 52,
      avgPaceSecKm: 300,
      avgHr: 150,
      maxHr: 160,
      cadence: 178,
      decouplingPct: null,
      efficiencyFactor: 1.2,
      avgTemp: 29,
      groundContactTime: 245,
      lt1Hr: 153,
      lt2Hr: 177,
      maxHeartRate: 203,
      intervals: [rep(152, 330), rep(153, 330), rep(152, 330)]
    } as any);

    const drift = summary.keyInsights.find(i => i.startsWith('Session Drift:'));
    expect(drift).toBeDefined();
    expect(drift).toContain('the threshold stimulus was not reached');
  });
});

describe('Walk-break coaching in the debrief', () => {
  /** Per-second records: contiguous run/walk segments at a fixed heart rate. */
  const records = (segments: Array<{ kind: 'run' | 'walk'; sec: number; hr: number }>) => {
    const out: any[] = [];
    let t = 0;
    for (const seg of segments) {
      for (let i = 0; i < seg.sec; i++) {
        out.push({
          elapsed_seconds: t,
          heart_rate: seg.hr,
          cadence: seg.kind === 'run' ? 172 : 110,
          speed_mps: seg.kind === 'run' ? 3.2 : 1.2,
          altitude_m: 20
        });
        t += 1;
      }
    }
    return out;
  };

  it('explains a high-Zone-2 easy run without claiming a ceiling breach', () => {
    const summary = generateCoachSummary({
      runType: 'easy_base',
      distanceKm: 8.5,
      durationMin: 50,
      avgPaceSecKm: 352,
      avgHr: 150,
      maxHr: 158,
      cadence: 178,
      decouplingPct: 3.0,
      efficiencyFactor: 1.15,
      avgTemp: 31.7,
      groundContactTime: 245,
      lt1Hr: 153,
      lt2Hr: 177,
      maxHeartRate: 203,
      steadyPaceSecKm: 350,
      steadyHr: 150,
      steadyCadence: 178,
      steadyStanceTime: 245,
      records: records([
        { kind: 'run', sec: 420, hr: 150 }, // upper Zone 2
        { kind: 'run', sec: 180, hr: 140 }
      ])
    } as any);

    const insight = summary.keyInsights.find(i => i.startsWith('Zone 2 Ceiling Held'));
    expect(insight).toBeDefined();
    expect(insight).toContain('you never crossed the 153 bpm LT1 ceiling');
    expect(insight).toContain('148-153 bpm');
    expect(insight).toContain('upper-easy / aerobic steady');
    expect(summary.keyInsights.some(i => i.startsWith('Clearly Easy:'))).toBe(false);
    const factor = summary.scoreBreakdown.find(f => f.category === 'Aerobic Intensity')!;
    expect(factor.label).toBe('Upper Easy / Aerobic Steady');
    expect(factor.points).toBeLessThan(factor.maxPoints);
  });

  it('calls a 34% upper-Zone-2 run clearly easy instead of flagging high-zone creep', () => {
    const summary = generateCoachSummary({
      runType: 'easy_base', distanceKm: 8.5, durationMin: 50,
      avgPaceSecKm: 352, avgHr: 144, maxHr: 158, cadence: 178,
      decouplingPct: 3.0, efficiencyFactor: 1.15, avgTemp: 20,
      groundContactTime: 245, lt1Hr: 153, lt2Hr: 177, maxHeartRate: 203,
      steadyPaceSecKm: 350, steadyHr: 144, steadyCadence: 178, steadyStanceTime: 245,
      records: records([
        { kind: 'run', sec: 206, hr: 150 },
        { kind: 'run', sec: 394, hr: 140 }
      ])
    } as any);

    const insight = summary.keyInsights.find(i => i.startsWith('Clearly Easy:'));
    expect(insight).toBeDefined();
    expect(insight).toContain('upper Zone 2 (148-153 bpm)');
    expect(summary.keyInsights.some(i => i.startsWith('Zone 2 Ceiling Held'))).toBe(false);
    expect(summary.scoreBreakdown.find(f => f.category === 'Aerobic Intensity')?.label).toBe('Clearly Easy');
  });

  it('credits walk breaks used to hold heart rate under the LT1 ceiling', () => {
    const summary = generateCoachSummary({
      runType: 'easy_base',
      distanceKm: 10,
      durationMin: 60,
      avgPaceSecKm: 345,
      avgHr: 141,
      maxHr: 150,
      cadence: 176,
      decouplingPct: 2.2,
      efficiencyFactor: 1.25,
      avgTemp: 31,
      groundContactTime: 245,
      lt1Hr: 150,
      lt2Hr: 175,
      maxHeartRate: 203,
      steadyPaceSecKm: 340,
      steadyHr: 141,
      steadyCadence: 176,
      steadyStanceTime: 245,
      records: records([
        { kind: 'run', sec: 700, hr: 140 },
        { kind: 'walk', sec: 50, hr: 142 },
        { kind: 'run', sec: 700, hr: 141 },
        { kind: 'walk', sec: 50, hr: 143 },
        { kind: 'run', sec: 700, hr: 140 }
      ])
    });

    const walkInsight = summary.keyInsights.find(i => i.startsWith('Walk-Break Strategy:'));
    expect(walkInsight).toBeDefined();
    expect(walkInsight).toContain('held heart rate under your 150 bpm LT1 ceiling');
    expect(summary.keyInsights.some(i => i.startsWith('Unplanned Walking:'))).toBe(false);
    const completion = summary.scoreBreakdown.find(f => f.category === 'Workout Completion');
    expect(completion?.points).toBe(completion?.maxPoints);
  });

  it('reports work reps interrupted by walking at or above LT1 without moralising', () => {
    const summary = generateCoachSummary({
      runType: 'threshold_lt2',
      distanceKm: 11,
      durationMin: 58,
      avgPaceSecKm: 315,
      avgHr: 165,
      maxHr: 180,
      cadence: 176,
      decouplingPct: null,
      efficiencyFactor: 1.2,
      avgTemp: 29,
      groundContactTime: 250,
      lt1Hr: 150,
      lt2Hr: 175,
      maxHeartRate: 203,
      records: records([
        { kind: 'run', sec: 600, hr: 170 },
        { kind: 'walk', sec: 60, hr: 172 },
        { kind: 'run', sec: 600, hr: 169 },
        { kind: 'walk', sec: 60, hr: 171 },
        { kind: 'run', sec: 600, hr: 168 }
      ])
    });

    const interruption = summary.keyInsights.find(i => i.startsWith('Work-Rep Interruption:'));
    expect(interruption).toBeDefined();
    expect(interruption).toContain('Walking was the right call at that heart rate');
    const completion = summary.scoreBreakdown.find(f => f.category === 'Workout Completion');
    expect(completion?.label).toBe('Rep-Interrupting Walk Breaks');
    expect(completion!.points).toBeLessThan(completion!.maxPoints);
  });
});
