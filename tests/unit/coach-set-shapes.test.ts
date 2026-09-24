import { describe, it, expect } from 'vitest';
import { gradeRun, describeSet } from '../../src/backend/physiology/coach-rubric.js';

const baseAerobic = {
  runType: 'threshold_lt2',
  isFailedWorkout: false,
  steadyHr: 165,
  steadyCadence: 178,
  steadyStanceTime: 240,
  decouplingPct: null,
  isAccidentalTempo: false,
  lt1Hr: 153,
  lt2Hr: 178,
  maxHeartRate: 203,
  activityMaxHr: 190,
  pauseBreakdown: null,
  records: null,
  splits: null,
  intervals: null
} as const;

describe('Interval-set shapes (generalisation)', () => {
  const rep = (sec: number, opts: { hr?: number; maxHr?: number; pace?: number } = {}) => ({
    type: 'work',
    duration_seconds: sec,
    avg_heart_rate: opts.hr ?? 178,
    max_heart_rate: opts.maxHr ?? 186,
    avg_pace_sec_km: opts.pace ?? 276
  });
  const recovery = (sec: number, drop = 30) => ({ type: 'recovery', duration_seconds: sec, hr_drop: drop });

  /** Builds a set: n reps of repSec, with recoverySec between them. */
  const buildSet = (n: number, repSec: number, recoverySec: number, driftPerRep = 0, hrPerRep = 0, pacePerRep = 0) => {
    const rows: any[] = [];
    for (let i = 0; i < n; i++) {
      rows.push(rep(repSec, {
        hr: 178 + i * hrPerRep,
        maxHr: 186 + i * hrPerRep,
        pace: 276 + i * pacePerRep
      }));
      if (i < n - 1) rows.push(recovery(recoverySec));
    }
    void driftPerRep;
    return rows;
  };

  const gradeSet = (rows: any[], extra: Record<string, unknown> = {}) => gradeRun({
    ...baseAerobic,
    runType: 'threshold_lt2',
    steadyCadence: 178,
    lt2Hr: 178,
    maxHeartRate: 203,
    intervals: rows,
    ...extra
  } as any);

  it('excludes warm-up stride recoveries from the reported set recovery', () => {
    // Warm-up strides carry their own short jog recoveries. They used to qualify
    // because a work rep merely existed somewhere later, which dragged the set's
    // recovery from 2:13 down to 1:54 in the coach summary.
    const rows: any[] = [
      recovery(1108),
      { type: 'stride', duration_seconds: 10 }, recovery(105),
      { type: 'stride', duration_seconds: 10 }, recovery(108),
      ...buildSet(3, 900, 133)
    ];
    expect(describeSet(rows)).toMatchObject({ repCount: 3, medianRepSec: 900, recoverySec: 133 });
  });

  it('describes each common set shape', () => {
    expect(describeSet(buildSet(3, 900, 90))).toMatchObject({ repCount: 3, medianRepSec: 900, shortReps: false, recoverySec: 90 });
    expect(describeSet(buildSet(10, 240, 120))).toMatchObject({ repCount: 10, medianRepSec: 240, shortReps: false });
    expect(describeSet(buildSet(12, 60, 60))).toMatchObject({ repCount: 12, medianRepSec: 60, shortReps: true });
    expect(describeSet(buildSet(8, 30, 90))).toMatchObject({ repCount: 8, medianRepSec: 30, shortReps: true });
    expect(describeSet(null)).toBeNull();
  });

  it('does not punish a long set for ordinary cardiac drift', () => {
    // 10 x 4 min (40 min of work) with +9 bpm of drift and no pace change
    const graded = gradeSet(buildSet(10, 240, 120, 0, 1, 0));
    const fatigue = graded.factors.find(f => f.category === 'Rep-to-Rep Fatigue')!;
    expect(fatigue.points).toBe(fatigue.maxPoints);
    expect(fatigue.description).toContain('drift allowed for the set length');
    expect(graded.score).toBeLessThanOrEqual(84); // No per-record zone evidence.
  });

  it('still fails a long set that genuinely decays', () => {
    // Same shape, but 25 bpm of HR climb and 40 s/km of pace fade
    const graded = gradeSet(buildSet(10, 240, 120, 0, 2.8, 4));
    const fatigue = graded.factors.find(f => f.category === 'Rep-to-Rep Fatigue')!;
    expect(fatigue.points).toBeLessThan(fatigue.maxPoints * 0.4);
    expect(fatigue.label).toBe('Late-Rep Collapse');
  });

  it('judges short reps on pace, not on heart-rate lag', () => {
    // 12 x 1 min: heart rate climbs across the set (HR lag) but pace is steady
    const shortRows = (paceStep: number) => {
      const rows: any[] = [];
      for (let i = 0; i < 12; i++) {
        rows.push(rep(60, { hr: 168 + i, maxHr: 176 + i, pace: 250 + i * paceStep }));
      }
      return rows;
    };
    const shortSteady = gradeSet(shortRows(0));
    const fatigue = shortSteady.factors.find(f => f.category === 'Rep-to-Rep Fatigue')!;
    expect(fatigue.points).toBe(fatigue.maxPoints);
    expect(fatigue.description).toContain('not graded: short reps carry HR lag');
    expect(shortSteady.score).toBeLessThanOrEqual(84); // No per-record zone evidence.

    // The same shape with the pace collapsing is caught on pace alone
    const shortFading = gradeSet(shortRows(3));
    const fadingFactor = shortFading.factors.find(f => f.category === 'Rep-to-Rep Fatigue')!;
    expect(fadingFactor.points).toBeLessThan(fadingFactor.maxPoints * 0.5);
  });

  it('anchors short reps on the peak heart rate, not the average', () => {
    // 12 x 1 min at a VO2 anchor: average work HR cannot reach it, but the peak does
    const shortReps = gradeSet(
      buildSet(12, 60, 60).map(r => (r.type === 'work' ? { ...r, avg_heart_rate: 178, max_heart_rate: 190 } : r)),
      { runType: 'intervals_vo2' }
    );
    const intensity = shortReps.factors.find(f => f.category === 'Pacing Discipline')!;
    expect(intensity.points).toBe(intensity.maxPoints);
    expect(intensity.description).toContain('peak work HR');

    // ...while a genuinely under-cooked short set still scores down
    const underCooked = gradeSet(
      buildSet(12, 60, 60).map(r => (r.type === 'work' ? { ...r, avg_heart_rate: 150, max_heart_rate: 155 } : r)),
      { runType: 'intervals_vo2' }
    );
    const weakIntensity = underCooked.factors.find(f => f.category === 'Pacing Discipline')!;
    expect(weakIntensity.points).toBeLessThan(weakIntensity.maxPoints * 0.6);
  });

  it('does not let a threshold session drift into VO2 and still score full marks', () => {
    // Identical heart-rate trace (peak 190) declared two ways.
    const rows = buildSet(12, 60, 60).map(r => (r.type === 'work' ? { ...r, avg_heart_rate: 182, max_heart_rate: 190 } : r));

    const asThreshold = gradeSet(rows);
    const thresholdIntensity = asThreshold.factors.find(f => f.category === 'Threshold Heart Rate')!;
    expect(thresholdIntensity.label).toBe('Drifted Into VO2 Territory');
    expect(thresholdIntensity.points).toBeLessThan(thresholdIntensity.maxPoints * 0.7);

    // The same trace logged as a VO2 session is on target — intent sets the anchor
    const asVo2 = gradeSet(rows, { runType: 'intervals_vo2' });
    const vo2Intensity = asVo2.factors.find(f => f.category === 'Pacing Discipline')!;
    expect(vo2Intensity.points).toBe(vo2Intensity.maxPoints);
    expect(asVo2.score).toBeGreaterThan(asThreshold.score);
  });

  it('keeps a long threshold set on the LT2 anchor when it drifts upward', () => {
    // 3 x 15 min averaging 16 bpm above the anchor is a VO2 session, not threshold
    const drifted = gradeSet([
      { type: 'work', duration_seconds: 900, avg_heart_rate: 194, max_heart_rate: 200, avg_pace_sec_km: 250 },
      { type: 'recovery', duration_seconds: 120, hr_drop: 40 },
      { type: 'work', duration_seconds: 900, avg_heart_rate: 194, max_heart_rate: 200, avg_pace_sec_km: 250 },
      { type: 'recovery', duration_seconds: 120, hr_drop: 40 },
      { type: 'work', duration_seconds: 900, avg_heart_rate: 194, max_heart_rate: 200, avg_pace_sec_km: 250 }
    ]);
    const intensity = drifted.factors.find(f => f.category === 'Threshold Heart Rate')!;
    expect(intensity.label).toBe('Drifted Into VO2 Territory');
    expect(intensity.description).toContain('average work HR');
  });

  it('keeps the same weighting profile across shapes', () => {
    const long = gradeSet(buildSet(3, 900, 90));
    const many = gradeSet(buildSet(10, 240, 120));
    const short = gradeSet(buildSet(12, 60, 60));
    for (const graded of [long, many, short]) {
      const byCategory = Object.fromEntries(graded.factors.map(f => [f.category, f.maxPoints]));
      expect(byCategory['Interval Execution']).toBe(10);
      expect(byCategory['Cardiovascular Stimulus']).toBeUndefined();
      expect(byCategory['Threshold Heart Rate']).toBe(15);
      expect(byCategory['Running Turnover']).toBe(5);
      expect(byCategory['Rep-to-Rep Fatigue']).toBe(10);
      expect(graded.factors.reduce((a, f) => a + f.maxPoints, 0)).toBeLessThanOrEqual(100);
      expect(graded.score).toBeGreaterThanOrEqual(0);
    }
  });
});
