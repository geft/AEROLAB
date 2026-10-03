import { describe, it, expect } from 'vitest';
import { gradeRun, runFamilyOf, walkSharePct, auditWalkBreaks, pacingConsistency, steadyPaceSegments, gradeAdjustedPace, lateCeilingWeight, selectRaceSplits } from '../../src/backend/physiology/coach-rubric.js';

const baseAerobic = {
  runType: 'easy_base',
  isFailedWorkout: false,
  steadyHr: 135,
  steadyCadence: 178,
  steadyStanceTime: 240,
  decouplingPct: 2.0,
  isAccidentalTempo: false,
  lt1Hr: 148,
  lt2Hr: 167,
  maxHeartRate: 203,
  activityMaxHr: 150,
  pauseBreakdown: null,
  intervals: null,
  splits: null
} as const;

it('does not judge a continuous tempo block against VO2/LT2 or missing repetitions', () => {
  const result = gradeRun({ ...baseAerobic, runType: 'tempo', steadyHr: 157,
    intervals: [{ type: 'work', start_seconds: 1200, duration_seconds: 3600,
      avg_heart_rate: 157, max_heart_rate: 162 }],
    pauseBreakdown: { stopCount: 0, stopDurationSeconds: 0, walkCount: 0,
      walkDurationSeconds: 0, walkDistanceMeters: 0, steadyRunningDurationSeconds: 6000,
      steadyRunningDistanceMeters: 16000, steadyPaceSecKm: 375, steadyHeartRate: 157,
      steadyCadence: 178, steadyStanceTimeMs: 240, steadyVertOscMm: 70 }
  });
  expect(result.verdict).toBe('insufficient_evidence');
  expect(result.factors.some(factor => ['cardiovascular_stimulus', 'threshold_heart_rate',
    'pacing_discipline'].includes(factor.categoryId ?? ''))).toBe(false);
  const completion = result.factors.find(factor => factor.categoryId === 'workout_completion');
  expect(completion?.points).toBe(completion?.maxPoints);
});

function breakDown(stopSeconds: number, walkSeconds: number) {
  return {
    stopCount: stopSeconds > 0 ? 1 : 0,
    stopDurationSeconds: stopSeconds,
    walkCount: walkSeconds > 0 ? 1 : 0,
    walkDurationSeconds: walkSeconds,
    walkDistanceMeters: walkSeconds > 0 ? 200 : 0,
    steadyRunningDurationSeconds: 3000,
    steadyRunningDistanceMeters: 9000,
    steadyPaceSecKm: 333,
    steadyHeartRate: 135,
    steadyCadence: 178,
    steadyStanceTimeMs: 240,
    steadyVertOscMm: 70
  };
}

function evenSplits(count: number, paceSecKm: number) {
  return Array.from({ length: count }, (_, i) => ({
    split_index: i + 1,
    duration_seconds: paceSecKm,
    avg_pace_sec_km: paceSecKm
  }));
}

/** Builds per-second records so walk blocks can be classified by context. */
function makeRecords(segments: Array<{ kind: 'run' | 'walk'; sec: number; hr: number; climbM?: number }>) {
  const out: any[] = [];
  let t = 0;
  let alt = 20;
  let dist = 0;
  for (const seg of segments) {
    const climbPerSec = (seg.climbM ?? 0) / seg.sec;
    const speed = seg.kind === 'run' ? 3.2 : 1.2;
    for (let i = 0; i < seg.sec; i++) {
      out.push({
        elapsed_seconds: t,
        heart_rate: seg.hr,
        cadence: seg.kind === 'run' ? 172 : 110,
        speed_mps: speed,
        distance_m: Number(dist.toFixed(1)),
        altitude_m: Number(alt.toFixed(2))
      });
      t += 1;
      dist += speed;
      alt += climbPerSec;
    }
  }
  return out;
}

/** Records with an explicit speed per segment (for pacing-stability tests). */
function makeRecordsWithSpeed(segments: Array<{ sec: number; speed: number }>) {
  const out: any[] = [];
  let t = 0;
  let dist = 0;
  for (const seg of segments) {
    for (let i = 0; i < seg.sec; i++) {
      out.push({
        elapsed_seconds: t,
        heart_rate: 132,
        cadence: 170,
        speed_mps: seg.speed,
        distance_m: Number(dist.toFixed(1)),
        altitude_m: 20
      });
      t += 1;
      dist += seg.speed;
    }
  }
  return out;
}

describe('Quality workout completion descriptions', () => {
  const intervals = [
    { type: 'work', start_seconds: 0, duration_seconds: 300 },
    { type: 'recovery', start_seconds: 300, duration_seconds: 60 },
    { type: 'work', start_seconds: 360, duration_seconds: 300 }
  ];

  it.each(['tempo', 'threshold_lt2', 'intervals_vo2'])('describes uninterrupted %s reps without a missing entry heart rate', runType => {
    const grade = gradeRun({ ...baseAerobic, runType, intervals,
      records: makeRecords([{ kind: 'run', sec: 300, hr: 170 },
        { kind: 'walk', sec: 60, hr: 172 }, { kind: 'run', sec: 300, hr: 170 }]) });
    const completion = grade.factors.find(f => f.categoryId === 'workout_completion')!;
    expect(completion.label).toBe('Unbroken Session');
    expect(completion.points).toBe(completion.maxPoints);
    expect(completion.description).toBe('2 work reps · no walking inside work reps');
    expect(completion.descriptionMessage?.id).toBe('fragment.work_reps_no_walking_inside_work_reps');
  });

  it('retains walking duration and measured entry heart rate for interrupted work', () => {
    const grade = gradeRun({ ...baseAerobic, runType: 'threshold_lt2', intervals,
      records: makeRecords([{ kind: 'run', sec: 120, hr: 170 },
        { kind: 'walk', sec: 40, hr: 170 }, { kind: 'run', sec: 500, hr: 170 }]) });
    const completion = grade.factors.find(f => f.categoryId === 'workout_completion')!;
    expect(completion.label).toBe('Rep-Interrupting Walk Breaks');
    expect(completion.description).toBe('2 work reps · 40s of walking inside work reps (average entry 170 bpm)');
    expect(completion.points).toBeLessThan(completion.maxPoints);
  });
});

describe('Weighted Execution Rubric', () => {
  it('separates run-type families with different weight profiles', () => {
    expect(runFamilyOf('easy_base')).toBe('aerobic');
    expect(runFamilyOf('long_run')).toBe('aerobic');
    expect(runFamilyOf('threshold_lt2')).toBe('quality');
    expect(runFamilyOf('intervals_vo2')).toBe('quality');
    expect(runFamilyOf('race')).toBe('race');
  });

  it('awards a max of 100 points across the aerobic rubric when every signal is present', () => {
    const result = gradeRun({
      ...baseAerobic,
      pauseBreakdown: breakDown(0, 0),
      splits: evenSplits(10, 300)
    });
    const total = result.factors.reduce((a, f) => a + f.maxPoints, 0);
    expect(total).toBe(100);
    expect(result.coveragePct).toBe(100);
    // Easy runs are graded on intensity control plus a categorical integrity gate
    expect(result.factors.map(f => f.category)).toEqual(['Aerobic Intensity', 'Workout Completion']);
    expect(result.factors.map(f => f.maxPoints)).toEqual([85, 15]);
  });

  it('grades nothing when there is no heart-rate signal, instead of inventing a score', () => {
    const nothing = gradeRun({ ...baseAerobic, steadyHr: null, decouplingPct: null, records: null });
    expect(nothing.factors).toHaveLength(0);
    expect(nothing.coveragePct).toBe(0);
    expect(nothing.score).toBe(70); // neutral, never a fake perfect score
  });

  it('scores intensity continuously, and treats less than 40% upper Zone 2 as clearly easy', () => {
    const steady = (hr: number) => makeRecordsWithSpeed([{ sec: 900, speed: 3.2 }]).map(r => ({ ...r, heart_rate: hr }));
    const compliant = gradeRun({ ...baseAerobic, lt1Hr: 148, records: steady(138) });
    const highZ2 = gradeRun({ ...baseAerobic, lt1Hr: 148, records: steady(146) });
    const aboveCeiling = gradeRun({ ...baseAerobic, lt1Hr: 148, records: steady(152) });
    expect(compliant.score).toBe(98);            // fully aerobic
    expect(highZ2.score).toBeLessThan(90);       // sustained top-of-Zone-2 costs
    expect(highZ2.score).toBeGreaterThan(60);
    expect(aboveCeiling.score).toBeLessThan(60); // above the ceiling is a failure
  });

  it('uses the top 5 bpm below LT1 as upper Zone 2 and applies the proposed classification bands', () => {
    const steady = (hr: number) => makeRecordsWithSpeed([{ sec: 600, speed: 3.2 }])
      .map(r => ({ ...r, heart_rate: hr }));
    const gradeShare = (sharePct: number) => {
      const records = makeRecordsWithSpeed([
        { sec: 600 * sharePct / 100, speed: 3.2 },
        { sec: 600 * (100 - sharePct) / 100, speed: 3.2 }
      ]).map(r => ({
        ...r,
        heart_rate: r.elapsed_seconds < 600 * sharePct / 100 ? 150 : 140
      }));
      return gradeRun({ ...baseAerobic, lt1Hr: 153, records });
    };

    expect(gradeRun({ ...baseAerobic, lt1Hr: 153, records: steady(147) })
      .factors.find(f => f.category === 'Aerobic Intensity')!.label).toBe('Clearly Easy');
    expect(gradeRun({ ...baseAerobic, lt1Hr: 153, records: steady(148) })
      .factors.find(f => f.category === 'Aerobic Intensity')!.label).toBe('Potentially Too Close to LT1');
    const clearlyEasy = gradeShare(35);
    const normalEasy = gradeShare(50);
    const upperEasy = gradeShare(70);
    const nearLt1 = gradeShare(90);
    expect(clearlyEasy.factors.find(f => f.category === 'Aerobic Intensity')!.label).toBe('Clearly Easy');
    expect(clearlyEasy.factors.find(f => f.category === 'Aerobic Intensity')!.points).toBe(85);
    expect(normalEasy.factors.find(f => f.category === 'Aerobic Intensity')!.label).toBe('Normal Easy');
    expect(upperEasy.factors.find(f => f.category === 'Aerobic Intensity')!.label).toBe('Upper Easy / Aerobic Steady');
    expect(nearLt1.factors.find(f => f.category === 'Aerobic Intensity')!.label).toBe('Potentially Too Close to LT1');
  });

  it('does not describe a ceiling-compliant run as a ceiling problem', () => {
    // Creep confined to the second half: compliant early, top of Zone 2 late
    const records = makeRecordsWithSpeed([{ sec: 270, speed: 3.2 }, { sec: 330, speed: 3.2 }])
      .map(r => ({ ...r, heart_rate: r.elapsed_seconds < 270 ? 140 : 150 }));

    const hot = gradeRun({ ...baseAerobic, lt1Hr: 153, ambientTempC: 31.7, durationMin: 50, records });
    const factor = hot.factors.find(f => f.category === 'Aerobic Intensity')!;
    expect(factor.label).toBe('Normal Easy');
    expect(factor.description).toContain('in the top of Zone 2 (148-153 bpm)');
    expect(factor.description).toContain('0.0% above the 153 bpm LT1 ceiling');
    const description = factor.description || '';
    expect(description.indexOf('Zone 2')).toBeLessThan(description.indexOf('above the')); // leads with the real problem

    expect(hot.focusAdvice).toBeNull();

    // Heat softens late creep only; cool weather gets no credit for the same trace
    const cool = gradeRun({ ...baseAerobic, lt1Hr: 153, ambientTempC: 16, durationMin: 50, records });
    const coolFactor = cool.factors.find(f => f.category === 'Aerobic Intensity')!;
    expect(coolFactor.points).toBeLessThan(factor.points);
  });

  it('smooths heart rate so jitter around a compliant average is not a failure', () => {
    // Mean 138 with ±6 bpm of beat-to-beat noise, LT1 ceiling 148: raw samples
    // repeatedly touch 144, which must not read as high Zone 2.
    const noisy = makeRecordsWithSpeed([{ sec: 1200, speed: 3.2 }]).map((r, i) => ({
      ...r,
      heart_rate: 138 + (i % 2 === 0 ? 6 : -6)
    }));
    const result = gradeRun({ ...baseAerobic, lt1Hr: 148, records: noisy });
    const factor = result.factors.find(f => f.category === 'Aerobic Intensity')!;
    expect(factor.points).toBe(factor.maxPoints);

    // Jitter around 152 (above the ceiling) must still fail
    const hot = makeRecordsWithSpeed([{ sec: 1200, speed: 3.2 }]).map((r, i) => ({
      ...r,
      heart_rate: 152 + (i % 2 === 0 ? 6 : -6)
    }));
    const hotResult = gradeRun({ ...baseAerobic, lt1Hr: 148, records: hot });
    const hotFactor = hotResult.factors.find(f => f.category === 'Aerobic Intensity')!;
    expect(hotFactor.points).toBeLessThan(hotFactor.maxPoints * 0.3);
  });

  it('discounts a late ceiling breach only when the session was both long and hot', () => {
    // A breach confined to the second half of the run
    const drifting = makeRecordsWithSpeed([{ sec: 400, speed: 3.2 }, { sec: 200, speed: 3.2 }, { sec: 400, speed: 3.2 }])
      .map(r => ({ ...r, heart_rate: r.elapsed_seconds >= 400 ? 156 : 142 }));
    const pointsFor = (ambientTempC: number, durationMin: number) => {
      const graded = gradeRun({ ...baseAerobic, lt1Hr: 148, records: drifting, ambientTempC, durationMin });
      return graded.factors.find(f => f.category === 'Aerobic Intensity')!.points;
    };

    // 1 h: penalised in every climate
    expect(pointsFor(31, 60)).toBe(pointsFor(16, 60));
    // 2 h in Singapore: the late breach is thermoregulatory, so it is excused
    const hot2h = pointsFor(32, 130);
    const cool2h = pointsFor(16, 130);
    expect(hot2h).toBeGreaterThan(cool2h);
    expect(hot2h).toBeGreaterThan(pointsFor(31, 60));
    // 2 h in cool weather: no heat excuse, so it still counts
    expect(cool2h).toBe(pointsFor(16, 60));
    expect(lateCeilingWeight(32, 130)).toBeLessThan(0.3);
    expect(lateCeilingWeight(16, 130)).toBe(1);
    expect(lateCeilingWeight(31, 60)).toBe(1);
  });

  it('weights race pacing far above race turnover', () => {
    const result = gradeRun({
      ...baseAerobic,
      runType: 'race',
      activityMaxHr: 196,
      steadyCadence: 182,
      pauseBreakdown: breakDown(0, 0),
      splits: evenSplits(5, 264)
    });
    const weights = Object.fromEntries(result.factors.map(f => [f.category, f.maxPoints]));
    expect(weights['Race Pacing Execution']).toBe(34);
    expect(weights['Running Turnover']).toBe(14);
    expect(result.family).toBe('race');
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it('penalises an early race surge and flags it as the biggest lever', () => {
    const result = gradeRun({
      ...baseAerobic,
      runType: 'race',
      activityMaxHr: 191,
      splits: [265, 280, 278, 275].map((p, i) => ({ split_index: i + 1, avg_pace_sec_km: p }))
    });
    const pacing = result.factors.find(f => f.category === 'Race Pacing Execution');
    expect(pacing?.label).toBe('Aggressive Early Surge / Positive Split');
    expect(result.score).toBeLessThan(85);
    expect(result.focusAdvice).toContain('Biggest Lever — Race');
  });

  it('never lets an accidental tempo or aborted workout out of the Bronze tier', () => {
    const tempo = gradeRun({ ...baseAerobic, isAccidentalTempo: true, steadyHr: 155 });
    expect(tempo.score).toBeLessThanOrEqual(69);
    const aborted = gradeRun({ ...baseAerobic, isFailedWorkout: true });
    expect(aborted.score).toBeLessThanOrEqual(69);
    expect(aborted.factors.some(f => f.category === 'Workout Completion' && f.points === 0)).toBe(true);
  });

  it('scores quality sessions on structure, stimulus, recovery, intensity, form and late-rep fatigue', () => {
    const result = gradeRun({
      ...baseAerobic,
      runType: 'intervals_vo2',
      steadyHr: 170,
      steadyCadence: 186,
      activityMaxHr: 193,
      intervals: [
        { type: 'work', duration_seconds: 237, avg_heart_rate: 178, max_heart_rate: 188, avg_pace_sec_km: 242 },
        { type: 'recovery', duration_seconds: 120, hr_drop: 62 },
        { type: 'work', duration_seconds: 239, avg_heart_rate: 179, max_heart_rate: 190, avg_pace_sec_km: 243 },
        { type: 'recovery', duration_seconds: 120, hr_drop: 56 },
        { type: 'work', duration_seconds: 242, avg_heart_rate: 181, max_heart_rate: 192, avg_pace_sec_km: 245 },
        { type: 'recovery', duration_seconds: 120, hr_drop: 55 },
        { type: 'work', duration_seconds: 239, avg_heart_rate: 183, max_heart_rate: 193, avg_pace_sec_km: 244 }
      ]
    });
    expect(result.factors.map(f => f.category)).toEqual([
      'Interval Execution',
      'Cardiovascular Stimulus',
      'Pacing Discipline',
      'Running Turnover',
      'Rep-to-Rep Fatigue'
    ]);
    // 4 reps at 95% HRmax with stable rep pace and HR: near-perfect
    expect(result.score).toBeGreaterThanOrEqual(98);
    expect(result.focusAdvice).toBeNull();
  });

  it('does not grade the raw HR drop between reps, because recovery length is the plan', () => {
    // Deliberately short recoveries: a small drop is the intent, not a failure
    const shortRecoveries = gradeRun({
      ...baseAerobic,
      runType: 'threshold_lt2',
      steadyCadence: 178,
      lt2Hr: 178,
      intervals: [
        { type: 'work', duration_seconds: 900, avg_heart_rate: 178, max_heart_rate: 184, avg_pace_sec_km: 276 },
        { type: 'recovery', duration_seconds: 90, hr_drop: 25 },
        { type: 'work', duration_seconds: 900, avg_heart_rate: 180, max_heart_rate: 186, avg_pace_sec_km: 276 },
        { type: 'recovery', duration_seconds: 90, hr_drop: 24 },
        { type: 'work', duration_seconds: 900, avg_heart_rate: 181, max_heart_rate: 187, avg_pace_sec_km: 277 }
      ]
    });
    expect(shortRecoveries.factors.some(f => f.category === 'Autonomic Recovery')).toBe(false);
    // Without per-record HR, threshold-zone exposure cannot be certified.
    expect(shortRecoveries.score).toBeLessThanOrEqual(84);
    expect(shortRecoveries.verdict).toBe('insufficient_evidence');

    // Long recoveries with a big drop must not score better for that reason alone
    const longRecoveries = gradeRun({
      ...baseAerobic,
      runType: 'threshold_lt2',
      steadyCadence: 178,
      lt2Hr: 178,
      intervals: [
        { type: 'work', duration_seconds: 900, avg_heart_rate: 178, max_heart_rate: 184, avg_pace_sec_km: 276 },
        { type: 'recovery', duration_seconds: 240, hr_drop: 45 },
        { type: 'work', duration_seconds: 900, avg_heart_rate: 180, max_heart_rate: 186, avg_pace_sec_km: 276 },
        { type: 'recovery', duration_seconds: 240, hr_drop: 44 },
        { type: 'work', duration_seconds: 900, avg_heart_rate: 181, max_heart_rate: 187, avg_pace_sec_km: 277 }
      ]
    });
    expect(Math.abs(longRecoveries.score - shortRecoveries.score)).toBeLessThanOrEqual(1);
  });

  it('makes threshold-zone time decisive while treating rep pace as secondary', () => {
    const intervals = [
      { type: 'work', start_seconds: 0, duration_seconds: 300, avg_heart_rate: 170, max_heart_rate: 180, avg_pace_sec_km: 250 },
      { type: 'recovery', start_seconds: 300, duration_seconds: 60 },
      { type: 'work', start_seconds: 360, duration_seconds: 300, avg_heart_rate: 170, max_heart_rate: 180, avg_pace_sec_km: 265 },
      { type: 'recovery', start_seconds: 660, duration_seconds: 60 },
      { type: 'work', start_seconds: 720, duration_seconds: 300, avg_heart_rate: 170, max_heart_rate: 180, avg_pace_sec_km: 280 }
    ];
    const records = Array.from({ length: 1020 }, (_, second) => ({
      elapsed_seconds: second, heart_rate: 170, cadence: 178, speed_mps: 3.5,
      distance_m: second * 3.5, altitude_m: 20
    }));
    const goodHr = gradeRun({ ...baseAerobic, runType: 'threshold_lt2', intervals, records });
    const lowHr = gradeRun({ ...baseAerobic, runType: 'threshold_lt2', intervals, records: records.map(record => ({ ...record, heart_rate: 150 })) });
    const zoneFactor = goodHr.factors.find(factor => factor.category === 'Threshold Zone Time');

    expect(zoneFactor?.maxPoints).toBe(50);
    expect(zoneFactor?.points).toBe(50);
    expect(zoneFactor?.description).toMatch(/^14m 59s within the LT2 band \(163-171 bpm\)/);
    expect(goodHr.score).toBeGreaterThanOrEqual(85);
    expect(goodHr.score).toBeGreaterThan(lowHr.score + 25);
    expect(lowHr.score).toBeLessThan(70);
  });

  it('penalises late-rep pace collapse in a quality session', () => {
    const rep = (pace: number) => ({ type: 'work', duration_seconds: 240, avg_heart_rate: 180, max_heart_rate: 190, avg_pace_sec_km: pace });
    const steadyReps = gradeRun({
      ...baseAerobic,
      runType: 'threshold_lt2',
      steadyCadence: 178,
      intervals: [rep(240), { type: 'recovery', duration_seconds: 120, hr_drop: 35 }, rep(242), { type: 'recovery', duration_seconds: 120, hr_drop: 35 }, rep(244)]
    });
    const collapsing = gradeRun({
      ...baseAerobic,
      runType: 'threshold_lt2',
      steadyCadence: 178,
      intervals: [rep(240), { type: 'recovery', duration_seconds: 120, hr_drop: 35 }, rep(258), { type: 'recovery', duration_seconds: 120, hr_drop: 35 }, rep(276)]
    });

    const steadyFatigue = steadyReps.factors.find(f => f.category === 'Rep-to-Rep Fatigue')!;
    const collapseFatigue = collapsing.factors.find(f => f.category === 'Rep-to-Rep Fatigue')!;
    expect(steadyFatigue.points).toBe(steadyFatigue.maxPoints);
    expect(collapseFatigue.points).toBeLessThan(collapseFatigue.maxPoints * 0.2);
    expect(collapseFatigue.label).toBe('Late-Rep Collapse');
    expect(collapseFatigue.description).toContain('last rep 36s/km slower than the first');
    expect(collapsing.score).toBeLessThan(steadyReps.score);
  });

  it('flags a set whose work heart rate climbs rep over rep', () => {
    const climbing = gradeRun({
      ...baseAerobic,
      runType: 'threshold_lt2',
      steadyCadence: 178,
      intervals: [
        { type: 'work', duration_seconds: 900, avg_heart_rate: 172, max_heart_rate: 178, avg_pace_sec_km: 276 },
        { type: 'recovery', duration_seconds: 90, hr_drop: 25 },
        { type: 'work', duration_seconds: 900, avg_heart_rate: 181, max_heart_rate: 188, avg_pace_sec_km: 276 },
        { type: 'recovery', duration_seconds: 90, hr_drop: 24 },
        { type: 'work', duration_seconds: 900, avg_heart_rate: 190, max_heart_rate: 196, avg_pace_sec_km: 277 }
      ]
    });
    const factor = climbing.factors.find(f => f.category === 'Rep-to-Rep Fatigue')!;
    expect(factor.description).toContain('work HR 18 bpm higher by the last rep');
    expect(factor.points).toBeLessThan(factor.maxPoints * 0.7);
  });

  it('grades pacing on the kilometres actually run, not on city-affected splits', () => {
    // 12 km of metronomic running at 3.2 m/s, with two walk breaks (km 3 and km 11)
    // that make the raw splits look erratic.
    const segments: Array<{ kind: 'run' | 'walk'; sec: number; hr: number }> = [];
    for (let i = 0; i < 12; i++) {
      segments.push({ kind: 'run', sec: 300, hr: 132 });
      if (i === 2) segments.push({ kind: 'walk', sec: 150, hr: 128 });
      if (i === 10) segments.push({ kind: 'walk', sec: 160, hr: 130 });
    }
    const citySplits = [
      { split_index: 1, avg_pace_sec_km: 312 },
      { split_index: 2, avg_pace_sec_km: 314 },
      { split_index: 3, avg_pace_sec_km: 520 }, // stop-heavy kilometre
      { split_index: 4, avg_pace_sec_km: 311 },
      { split_index: 5, avg_pace_sec_km: 313 },
      { split_index: 6, avg_pace_sec_km: 315 },
      { split_index: 7, avg_pace_sec_km: 310 },
      { split_index: 8, avg_pace_sec_km: 312 },
      { split_index: 9, avg_pace_sec_km: 314 },
      { split_index: 10, avg_pace_sec_km: 311 },
      { split_index: 11, avg_pace_sec_km: 540 },
      { split_index: 12, avg_pace_sec_km: 312 }
    ];

    const withTelemetry = pacingConsistency(makeRecords(segments), citySplits, 'easy_base')!;
    expect(withTelemetry.source).toBe('records');
    expect(withTelemetry.cvPct).toBeLessThan(2);
    expect(withTelemetry.affectedCount).toBeGreaterThan(0);

    // The same run judged on raw splits only looks erratic
    const splitsOnly = pacingConsistency(null, citySplits, 'easy_base')!;
    expect(splitsOnly.source).toBe('splits');
    expect(splitsOnly.cvPct).toBeGreaterThan(10);
    expect(splitsOnly.cvPct).toBeGreaterThan(withTelemetry.cvPct);
  });

  it('does not punish a deliberate progression as erratic pacing', () => {
    // Speeds 3.0 -> 3.3 m/s: a steady acceleration with almost no residual spread
    const progressive = pacingConsistency(
      makeRecordsWithSpeed([
        { sec: 300, speed: 3.0 },
        { sec: 300, speed: 3.1 },
        { sec: 300, speed: 3.2 },
        { sec: 300, speed: 3.3 }
      ]),
      null,
      'easy_base'
    );
    expect(progressive).not.toBeNull();
    expect(progressive!.cvPct).toBeLessThan(1.0);      // ~no variance around the trend
    expect(progressive!.trendSecPerKm).toBeLessThan(-5); // and the trend itself is visible
    expect(progressive!.rawCvPct).toBeGreaterThan(progressive!.cvPct);
  });

  it('still flags genuinely erratic pacing', () => {
    const erratic = pacingConsistency(
      makeRecordsWithSpeed([
        { sec: 300, speed: 3.4 },
        { sec: 300, speed: 2.6 },
        { sec: 300, speed: 3.4 },
        { sec: 300, speed: 2.6 }
      ]),
      null,
      'easy_base'
    );
    expect(erratic).not.toBeNull();
    expect(erratic!.cvPct).toBeGreaterThan(8);
  });

  it('computes walk-break share from pause telemetry and ignores runs without any', () => {
    expect(walkSharePct(null)).toBeNull();
    expect(walkSharePct(breakDown(0, 0))).toBe(0);
    // Traffic stops are excluded: only the 300s of walking counts
    expect(walkSharePct(breakDown(300, 300))).toBeCloseTo(8.3, 0);
    expect(walkSharePct(breakDown(0, 300))).toBeCloseTo(9.1, 0);
  });

  it('caps grade adjustments so altimeter noise cannot corrupt pacing variance', () => {
    expect(gradeAdjustedPace(400, 0, 1000)).toBe(400);
    expect(gradeAdjustedPace(400, 10, 1000)).toBe(388); // 1% grade ≈ 12 s/km credit
    // A 300 m "climb" in one kilometre is GPS noise, not a wall: capped at 10% grade / 60 s/km
    expect(gradeAdjustedPace(400, 300, 1000)).toBe(340);
    // The adjustment can never invert the pace
    expect(gradeAdjustedPace(200, 500, 1000)).toBe(140);
  });

  it('ignores altitude spikes when accumulating per-kilometre climb', () => {
    const flat = (sec: number, alt: number, offsetSec: number, offsetM: number) =>
      Array.from({ length: sec }, (_, i) => ({
        elapsed_seconds: offsetSec + i,
        cadence: 172,
        speed_mps: 3.2,
        distance_m: offsetM + i * 3.2,
        altitude_m: alt
      }));

    // 3 km of flat running with a single 50 m altimeter spike in the middle
    const spiky = [
      ...flat(430, 20, 0, 0),
      { elapsed_seconds: 430, cadence: 172, speed_mps: 3.2, distance_m: 1376, altitude_m: 70 },
      ...flat(430, 20, 431, 1379.2)
    ];
    const spikySegments = steadyPaceSegments(spiky)!;
    expect(spikySegments.length).toBeGreaterThanOrEqual(3);
    expect(spikySegments.every(s => s.climbM < 5)).toBe(true);

    // A real ramp: +12 m of steady climb inside the first kilometre
    const ramp = [
      ...Array.from({ length: 200 }, (_, i) => ({
        elapsed_seconds: i, cadence: 172, speed_mps: 3.2, distance_m: i * 3.2, altitude_m: 20 + i * 0.06
      })),
      ...flat(700, 32, 200, 640)
    ];
    const rampSegments = steadyPaceSegments(ramp)!;
    expect(rampSegments[0].climbM).toBeGreaterThan(5);
  });

  it('restricts race splits to the recorded effort window when intervals exist', () => {
    const splits = Array.from({ length: 10 }, (_, i) => ({
      split_index: i + 1,
      duration_seconds: 300,
      avg_pace_sec_km: 300
    }));
    const raceSplits = selectRaceSplits(splits, [
      { type: 'work', start_seconds: 600, duration_seconds: 600 }
    ]);
    expect(raceSplits.length).toBeLessThan(splits.length);
    expect(raceSplits.every(s => s.avg_pace_sec_km === 300)).toBe(true);
  });
});

describe('Walk-break classification', () => {
  const opts = { lt1Hr: 150, lt2Hr: 175 };

  it('does not count walking that held heart rate under the aerobic ceiling', () => {
    // Mid-run 60s walk entered at 142 bpm (inside the aerobic band, no gradient)
    const audit = auditWalkBreaks(makeRecords([
      { kind: 'run', sec: 600, hr: 140 },
      { kind: 'walk', sec: 60, hr: 142 },
      { kind: 'run', sec: 600, hr: 140 }
    ]), opts)!;

    expect(audit.blockCount).toBe(1);
    expect(audit.preventiveWalkSec).toBeGreaterThan(50);
    expect(audit.capacityWalkSec).toBe(0);
    expect(audit.intrusiveWalkSec).toBe(0);
    expect(audit.avgPreventiveEntryHr).toBe(140);
  });

  it('counts walking entered at or above LT1 as intrusive and walking far below the band as unexplained', () => {
    const intrusive = auditWalkBreaks(makeRecords([
      { kind: 'run', sec: 300, hr: 168 },
      { kind: 'walk', sec: 40, hr: 170 },
      { kind: 'run', sec: 300, hr: 168 }
    ]), opts)!;
    expect(intrusive.intrusiveWalkSec).toBeGreaterThan(30);
    expect(intrusive.avgCorrectiveEntryHr).toBe(168);

    const unexplained = auditWalkBreaks(makeRecords([
      { kind: 'run', sec: 300, hr: 120 },
      { kind: 'walk', sec: 60, hr: 112 },
      { kind: 'run', sec: 300, hr: 120 }
    ]), opts)!;
    expect(unexplained.capacityWalkSec).toBeGreaterThan(50);
    expect(unexplained.avgCapacityEntryHr).toBe(120);
    expect(unexplained.intrusiveWalkSec).toBe(0);
  });

  it('treats gradient and warm-up/cool-down walking as deliberate', () => {
    const ramp = auditWalkBreaks(makeRecords([
      { kind: 'run', sec: 600, hr: 138 },
      { kind: 'walk', sec: 60, hr: 132, climbM: 12 },
      { kind: 'run', sec: 600, hr: 138 }
    ]), opts)!;
    expect(ramp.deliberateWalkSec).toBeGreaterThan(50);
    expect(ramp.capacityWalkSec).toBe(0);

    const edges = auditWalkBreaks(makeRecords([
      { kind: 'walk', sec: 60, hr: 120 },
      { kind: 'run', sec: 900, hr: 140 },
      { kind: 'walk', sec: 60, hr: 118 }
    ]), opts)!;
    expect(edges.deliberateWalkSec).toBeGreaterThan(100);
    expect(edges.capacityWalkSec).toBe(0);
  });

  it('accepts brief low-HR easy-run breaks without inferring fatigue', () => {
    const audit = auditWalkBreaks(makeRecords([
      { kind: 'run', sec: 720, hr: 125 },
      { kind: 'walk', sec: 33, hr: 122 },
      { kind: 'run', sec: 800, hr: 138 }
    ]), { ...opts, allowBriefAerobicBreaks: true })!;
    expect(audit.capacityWalkSec).toBe(0);
    expect(audit.deliberateWalkSec).toBe(33);
  });

  it('does not mistake high-HR cooldown walking for a work-rep interruption', () => {
    const records = makeRecords([
      { kind: 'run', sec: 300, hr: 170 },
      { kind: 'walk', sec: 180, hr: 165 },
      { kind: 'run', sec: 600, hr: 140 }
    ]);
    const audit = auditWalkBreaks(records, { ...opts, workWindows: [{ from: 0, to: 300 }] })!;
    expect(audit.intrusiveWalkSec).toBe(0);
    expect(audit.deliberateWalkSec).toBe(180);
    const inside = auditWalkBreaks(records, { ...opts, workWindows: [{ from: 0, to: 600 }] })!;
    expect(inside.intrusiveWalkSec).toBe(180);
  });

  it.each([
    ['5K', 1200],
    ['10K', 2400],
    ['half marathon', 5400]
  ])('does not penalise the break between a race warm-up and the %s effort', (_distance, effortSec) => {
    const records = makeRecords([
      { kind: 'run', sec: 600, hr: 116 },
      { kind: 'walk', sec: 133, hr: 108 },
      { kind: 'run', sec: effortSec, hr: 177 }
    ]);
    const race = gradeRun({
      ...baseAerobic,
      runType: 'race',
      records,
      intervals: [{ type: 'work', start_seconds: 733, duration_seconds: effortSec }]
    });
    expect(race.walkAudit?.deliberateWalkSec).toBe(133);
    expect(race.walkAudit?.capacityWalkSec).toBe(0);
    expect(race.walkAudit?.intrusiveWalkSec).toBe(0);
    const completion = race.factors.find(f => f.category === 'Workout Completion');
    expect(completion?.points).toBe(completion?.maxPoints);

  });

  it('still scores walking inside the detected race effort', () => {
    const race = gradeRun({
      ...baseAerobic,
      runType: 'race',
      records: makeRecords([
        { kind: 'run', sec: 600, hr: 116 },
        { kind: 'run', sec: 1200, hr: 177 },
        { kind: 'walk', sec: 133, hr: 108 },
        { kind: 'run', sec: 1200, hr: 177 }
      ]),
      intervals: [{ type: 'work', start_seconds: 600, duration_seconds: 2533 }]
    });
    expect(race.walkAudit?.intrusiveWalkSec).toBe(133);
    const completion = race.factors.find(f => f.category === 'Workout Completion');
    expect(completion?.points).toBeLessThan(completion!.maxPoints);
  });

  it('recognises a regular run/walk rhythm as a planned session', () => {
    const segments: Array<{ kind: 'run' | 'walk'; sec: number; hr: number }> = [];
    for (let i = 0; i < 6; i++) {
      segments.push({ kind: 'run', sec: 120, hr: 138 });
      segments.push({ kind: 'walk', sec: 30, hr: 130 });
    }
    const audit = auditWalkBreaks(makeRecords(segments), opts)!;
    expect(audit.blockCount).toBe(6);
    expect(audit.plannedPattern).toBe(true);
    expect(audit.capacityWalkSec).toBe(0);
  });

  it('returns null when there is no cadence telemetry to judge from', () => {
    const noCadence = makeRecords([{ kind: 'run', sec: 300, hr: 140 }]).map(r => ({ ...r, cadence: 0 }));
    expect(auditWalkBreaks(noCadence, opts)).toBeNull();
    expect(auditWalkBreaks(null, opts)).toBeNull();
  });

  it('ignores brief loop-turnaround dips (short and barely any ground covered)', () => {
    const segments: Array<{ kind: 'run' | 'walk'; sec: number; hr: number }> = [];
    for (let i = 0; i < 6; i++) {
      segments.push({ kind: 'run', sec: 300, hr: 145 });
      segments.push({ kind: 'walk', sec: 6, hr: 150 }); // pivot at the 1.7 km loop end
    }
    const audit = auditWalkBreaks(makeRecords(segments), opts)!;
    expect(audit.rawBlockCount).toBe(6);
    expect(audit.artifactBlockCount).toBe(6);
    expect(audit.blockCount).toBe(0);
    // Nothing is charged to the session, and no walk seconds are counted either
    expect(audit.intrusiveWalkSec).toBe(0);
    expect(audit.capacityWalkSec).toBe(0);
    expect(audit.deliberateWalkSec).toBe(0);
  });

  it('treats walking inside a prescribed recovery window as the session design', () => {
    const records = makeRecords([
      { kind: 'run', sec: 300, hr: 170 },
      { kind: 'walk', sec: 60, hr: 172 }, // recovery break, planned
      { kind: 'run', sec: 300, hr: 170 }
    ]);
    const withWindows = auditWalkBreaks(records, { ...opts, recoveryWindows: [{ from: 300, to: 360 }] })!;
    expect(withWindows.recoveryWalkSec).toBeGreaterThan(50);
    expect(withWindows.recoveryBlockCount).toBe(1);
    expect(withWindows.intrusiveWalkSec).toBe(0);

    const grade = gradeRun({
      ...baseAerobic,
      runType: 'threshold_lt2',
      steadyHr: 170,
      records,
      intervals: [
        { type: 'work', start_seconds: 0, duration_seconds: 300 },
        { type: 'recovery', start_seconds: 300, duration_seconds: 60 },
        { type: 'work', start_seconds: 360, duration_seconds: 300 }
      ]
    });
    const completion = grade.factors.find(f => f.category === 'Workout Completion');
    expect(completion?.points).toBe(completion?.maxPoints);
    expect(completion?.label).toBe('Unbroken Session');
  });

  it('does not charge for walk breaks unless the session was mostly walking', () => {
    // Deliberate ceiling-control walking: full marks on the integrity gate
    const direct = gradeRun({
      ...baseAerobic,
      records: makeRecords([
        { kind: 'run', sec: 600, hr: 140 },
        { kind: 'walk', sec: 60, hr: 142 },
        { kind: 'run', sec: 600, hr: 140 }
      ])
    });
    const completion = direct.factors.find(f => f.category === 'Workout Completion')!;
    expect(completion.points).toBe(completion.maxPoints);
    expect(completion.label).toBe('Unbroken Session');

    // 5 min walking inside a 6 min "run" is a walk, not a run
    const walkDominated = gradeRun({
      ...baseAerobic,
      records: makeRecords([
        { kind: 'run', sec: 120, hr: 140 },
        { kind: 'walk', sec: 420, hr: 128 },
        { kind: 'run', sec: 120, hr: 140 }
      ])
    });
    const walkFactor = walkDominated.factors.find(f => f.category === 'Workout Completion')!;
    expect(walkFactor.points).toBeLessThan(walkFactor.maxPoints);
    expect(direct.score).toBeGreaterThan(walkDominated.score);
  });

  it('credits a structured run/walk session plan instead of penalising the walking', () => {
    const segments: Array<{ kind: 'run' | 'walk'; sec: number; hr: number }> = [];
    for (let i = 0; i < 6; i++) {
      segments.push({ kind: 'run', sec: 120, hr: 138 });
      segments.push({ kind: 'walk', sec: 60, hr: 130 });
    }
    const result = gradeRun({ ...baseAerobic, records: makeRecords(segments) });
    const completion = result.factors.find(f => f.category === 'Workout Completion')!;
    expect(result.walkAudit?.plannedPattern).toBe(true);
    expect(completion.points).toBe(completion.maxPoints);
  });
});
