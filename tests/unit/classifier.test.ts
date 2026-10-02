import { describe, it, expect } from 'vitest';
import { classifyRun } from '../../src/backend/ingestion/classifier';
import { ActivityMetadata, ActivityRecord } from '../../src/backend/ingestion/csv-parser';
import { EconomyMetrics } from '../../src/backend/physiology/economy';
import { DetectedInterval } from '../../src/backend/ingestion/interval-detector';

describe('Run Classifier Engine (Unit)', () => {
  const baseMetadata: ActivityMetadata = {
    id: '123456',
    name: 'Singapore Run',
    sport: 'running',
    date: '2026-09-11 19:50:00',
    totalDistanceMeters: 8000,
    totalDurationSeconds: 2400, // 40 min
    totalElapsedSeconds: 2450,
    avgHeartRate: 135,
    maxHeartRate: 180,
    avgCadence: 165,
    maxCadence: 175,
    calories: 450,
    totalAscentMeters: 10,
    totalDescentMeters: 10
  };

  const baseEconomy: EconomyMetrics = {
    efficiencyFactor: 1.15,
    aerobicDecouplingPct: 2.1,
    metersPerBeat: 360,
    firstHalfEf: 1.16,
    secondHalfEf: 1.14,
    movingDurationSeconds: 3000,
    movingDistanceMeters: 10000,
    avgMovingPaceSecKm: 300,
    avgMovingHeartRate: 140
  };

  function createMockRecords(durationSec: number, hr: number): ActivityRecord[] {
    return Array.from({ length: durationSec }, (_, i) => ({
      timestamp: `2026-09-11T19:${Math.floor(i / 60)}:${i % 60}Z`,
      elapsedSeconds: i,
      heartRate: hr,
      cadence: 165,
      speedMps: 3.3,
      distanceMeters: i * 3.3,
      altitudeMeters: 10,
      latitude: null,
      longitude: null,
      temperature: 28,
      verticalOscillation: 7.0,
      stanceTime: 240
    }));
  }

  it('classifies sustained race intensity identically under arbitrary titles', () => {
    const titles = ['', 'Evening Running', '5k Time Trial', 'Morning 10k TT', 'Sunday Race Day', 'Bedok Reservoir Parkrun', 'Recovery VO2 Tempo'];
    for (const name of titles) {
      const meta = { ...baseMetadata, name };
      const records = createMockRecords(1200, 175);
      const res = classifyRun(meta, records, baseEconomy, []);
      expect(res.runType).toBe('race');
      expect(res.confidence).toBe(0.88);
    }
  });

  it('ignores race, recovery, VO2 and failure words when the recorded effort is aerobic', () => {
    const records = createMockRecords(2400, 145);
    const profile = { maxHr: 203, restingHr: 55, lt1Hr: 148, lt2Hr: 167 };
    const baseline = classifyRun(baseMetadata, records, baseEconomy, [], profile);
    expect(baseline.runType).toBe('easy_base');
    for (const name of ['Parkrun Race Time Trial TT', 'VO2 V02 Intervals', 'Recovery', 'Graceful Marathon Pace Tempo Failed Aborted DNF']) {
      expect(classifyRun({ ...baseMetadata, name }, records, baseEconomy, [], profile)).toEqual(baseline);
    }
  });

  it('does not let VO2 keywords elevate short low-intensity reps', () => {
    const work = { intervalIndex: 1, type: 'work' as const, startSeconds: 200, durationSeconds: 60, distanceMeters: 200, avgSpeedMps: 3.3, avgPaceSecKm: 303, avgHeartRate: 145, maxHeartRate: 155, avgCadence: 175 };
    const records = createMockRecords(2400, 145);
    const intervals = [work, { ...work, intervalIndex: 2, startSeconds: 400 }];
    expect(classifyRun({ ...baseMetadata, name: 'VO2 Max Intervals' }, records, baseEconomy, intervals,
      { maxHr: 203, restingHr: 55, lt1Hr: 148, lt2Hr: 167 }).runType).toBe('easy_base');
  });

  it('recognizes six-minute VO2 reps before the overlapping threshold duration rule', () => {
    const work = { intervalIndex: 1, type: 'work' as const, startSeconds: 200, durationSeconds: 360, distanceMeters: 1200, avgSpeedMps: 3.3, avgPaceSecKm: 303, avgHeartRate: 190, maxHeartRate: 195, avgCadence: 175 };
    const intervals = [work, { ...work, intervalIndex: 2, startSeconds: 800 }];
    expect(classifyRun(baseMetadata, createMockRecords(1800, 150), baseEconomy, intervals,
      { maxHr: 203, restingHr: 55, lt1Hr: 148, lt2Hr: 167 }).runType).toBe('intervals_vo2');
  });

  it('does not demote hard reps with walking recoveries to an aerobic run/walk session', () => {
    const records = createMockRecords(7200, 140);
    const intervals: DetectedInterval[] = [];
    for (let rep = 0; rep < 5; rep++) {
      const start = 3000 + rep * 300;
      intervals.push({ intervalIndex: rep * 2 + 1, type: 'work', startSeconds: start, durationSeconds: 180, distanceMeters: 600, avgSpeedMps: 3.3, avgPaceSecKm: 303, avgHeartRate: 190, maxHeartRate: 195, avgCadence: 175 });
      intervals.push({ intervalIndex: rep * 2 + 2, type: 'recovery', startSeconds: start + 180, durationSeconds: 120, distanceMeters: 180, avgSpeedMps: 1.5, avgPaceSecKm: 667, avgHeartRate: 140, maxHeartRate: 190, avgCadence: 110 });
      for (let index = start; index < start + 180; index++) records[index].heartRate = 190;
    }
    const result = classifyRun({ ...baseMetadata, avgHeartRate: 146, totalDurationSeconds: 7200 }, records, baseEconomy, intervals,
      { maxHr: 203, restingHr: 55, lt1Hr: 148, lt2Hr: 167 });
    expect(result.runType).toBe('intervals_vo2');
    expect(result.isFailedWorkout).toBe(false);
  });

  it('does not call an upper-aerobic block inside a long run threshold work', () => {
    const records = createMockRecords(7200, 150);
    for (let index = 5000; index < 6200; index++) records[index].heartRate = 169;
    const interval: DetectedInterval = { intervalIndex: 1, type: 'work', startSeconds: 5000, durationSeconds: 1200, distanceMeters: 4000, avgSpeedMps: 3.3, avgPaceSecKm: 303, avgHeartRate: 169, maxHeartRate: 175, avgCadence: 175 };
    expect(classifyRun({ ...baseMetadata, totalDurationSeconds: 7200 }, records, baseEconomy, [interval],
      { maxHr: 203, restingHr: 54, lt1Hr: 151, lt2Hr: 176 }).runType).toBe('long_run');
  });

  it('classifies as intervals_vo2 when 2+ work reps are detected', () => {
    const intervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 100, durationSeconds: 180, distanceMeters: 900, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 165, maxHeartRate: 172, avgCadence: 180 },
      { intervalIndex: 2, type: 'recovery', startSeconds: 280, durationSeconds: 60, distanceMeters: 100, avgSpeedMps: 1.6, avgPaceSecKm: 600, avgHeartRate: 140, maxHeartRate: 165, avgCadence: 110 },
      { intervalIndex: 3, type: 'work', startSeconds: 340, durationSeconds: 180, distanceMeters: 900, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 168, maxHeartRate: 175, avgCadence: 182 }
    ];

    const records = createMockRecords(1200, 150);
    const result = classifyRun(baseMetadata, records, baseEconomy, intervals);
    expect(result.runType).toBe('intervals_vo2');
    expect(result.isFailedWorkout).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('marks vo2 as failed on HR fade or insufficient volume (pace-free)', () => {
    // 3 work reps where peak HR fades >8 bpm from early to late reps
    const fadedIntervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 100, durationSeconds: 180, distanceMeters: 900, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 170, maxHeartRate: 178, avgCadence: 180 },
      { intervalIndex: 2, type: 'recovery', startSeconds: 280, durationSeconds: 60, distanceMeters: 100, avgSpeedMps: 1.6, avgPaceSecKm: 600, avgHeartRate: 140, maxHeartRate: 170, avgCadence: 110 },
      { intervalIndex: 3, type: 'work', startSeconds: 340, durationSeconds: 180, distanceMeters: 900, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 168, maxHeartRate: 176, avgCadence: 180 },
      { intervalIndex: 4, type: 'recovery', startSeconds: 520, durationSeconds: 60, distanceMeters: 100, avgSpeedMps: 1.6, avgPaceSecKm: 600, avgHeartRate: 140, maxHeartRate: 168, avgCadence: 110 },
      { intervalIndex: 5, type: 'work', startSeconds: 580, durationSeconds: 180, distanceMeters: 900, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 160, maxHeartRate: 165, avgCadence: 178 }
    ];
    const recs = createMockRecords(1200, 155);
    const resFade = classifyRun(baseMetadata, recs, baseEconomy, fadedIntervals);
    expect(resFade.runType).toBe('intervals_vo2');
    expect(resFade.isFailedWorkout).toBe(true);

    // Total work duration < 360s
    const shortIntervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 100, durationSeconds: 100, distanceMeters: 500, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 165, maxHeartRate: 175, avgCadence: 180 },
      { intervalIndex: 2, type: 'work', startSeconds: 260, durationSeconds: 100, distanceMeters: 500, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 168, maxHeartRate: 175, avgCadence: 180 }
    ];
    const resShort = classifyRun(baseMetadata, recs, baseEconomy, shortIntervals);
    expect(resShort.runType).toBe('intervals_vo2');
    expect(resShort.isFailedWorkout).toBe(true);

    // Same structure at low HR never reaches the stimulus band: not quality at all
    const flatIntervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 100, durationSeconds: 180, distanceMeters: 700, avgSpeedMps: 3.9, avgPaceSecKm: 256, avgHeartRate: 148, maxHeartRate: 152, avgCadence: 170 },
      { intervalIndex: 2, type: 'recovery', startSeconds: 280, durationSeconds: 60, distanceMeters: 100, avgSpeedMps: 1.6, avgPaceSecKm: 600, avgHeartRate: 135, maxHeartRate: 150, avgCadence: 110 },
      { intervalIndex: 3, type: 'work', startSeconds: 340, durationSeconds: 180, distanceMeters: 700, avgSpeedMps: 3.9, avgPaceSecKm: 256, avgHeartRate: 149, maxHeartRate: 153, avgCadence: 170 }
    ];
    const resFlat = classifyRun(baseMetadata, createMockRecords(1200, 148), baseEconomy, flatIntervals);
    expect(resFlat.runType).not.toBe('intervals_vo2');
    expect(resFlat.runType).not.toBe('threshold_lt2');
  });

  it('classifies as threshold_lt2 intervals for long work bouts (>=450s sustained high BPM)', () => {
    const thresholdIntervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 300, durationSeconds: 600, distanceMeters: 2500, avgSpeedMps: 4.16, avgPaceSecKm: 240, avgHeartRate: 168, maxHeartRate: 174, avgCadence: 178 },
      { intervalIndex: 2, type: 'recovery', startSeconds: 900, durationSeconds: 120, distanceMeters: 300, avgSpeedMps: 2.5, avgPaceSecKm: 400, avgHeartRate: 140, maxHeartRate: 168, avgCadence: 140 },
      { intervalIndex: 3, type: 'work', startSeconds: 1020, durationSeconds: 600, distanceMeters: 2500, avgSpeedMps: 4.16, avgPaceSecKm: 240, avgHeartRate: 170, maxHeartRate: 176, avgCadence: 178 }
    ];
    const records = createMockRecords(2000, 160);
    const result = classifyRun(baseMetadata, records, baseEconomy, thresholdIntervals);
    expect(result.runType).toBe('threshold_lt2');
    expect(result.isFailedWorkout).toBe(false);
  });

  it('classifies threshold intervals by duration structure and zone distribution', () => {
    // Title includes 'threshold' and avg work HR >= 160
    const meta = { ...baseMetadata, name: 'Threshold Cruise Intervals' };
    const intervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 300, durationSeconds: 400, distanceMeters: 1600, avgSpeedMps: 4.0, avgPaceSecKm: 250, avgHeartRate: 162, maxHeartRate: 166, avgCadence: 175 }
    ];
    // Record HR high enough for threshold
    const records = createMockRecords(1200, 162);
    const res = classifyRun(meta, records, baseEconomy, intervals);
    expect(res.runType).toBe('threshold_lt2');
    expect(res.isFailedWorkout).toBe(true); // only 1 rep < 480s total work
  });

  it('marks threshold as failed on HR fade or single short rep (pace-free)', () => {
    // Title keywords are ignored: neutral name, HR fade across two long reps
    const meta = { ...baseMetadata, name: 'Tuesday Threshold Session' };
    const intervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 300, durationSeconds: 500, distanceMeters: 2000, avgSpeedMps: 4.0, avgPaceSecKm: 250, avgHeartRate: 170, maxHeartRate: 176, avgCadence: 175 },
      { intervalIndex: 2, type: 'recovery', startSeconds: 800, durationSeconds: 120, distanceMeters: 300, avgSpeedMps: 2.5, avgPaceSecKm: 400, avgHeartRate: 140, maxHeartRate: 170, avgCadence: 140 },
      { intervalIndex: 3, type: 'work', startSeconds: 920, durationSeconds: 500, distanceMeters: 2000, avgSpeedMps: 4.0, avgPaceSecKm: 250, avgHeartRate: 162, maxHeartRate: 166, avgCadence: 175 },
      { intervalIndex: 4, type: 'recovery', startSeconds: 1420, durationSeconds: 120, distanceMeters: 300, avgSpeedMps: 2.5, avgPaceSecKm: 400, avgHeartRate: 140, maxHeartRate: 164, avgCadence: 140 },
      { intervalIndex: 5, type: 'work', startSeconds: 1540, durationSeconds: 500, distanceMeters: 2000, avgSpeedMps: 4.0, avgPaceSecKm: 250, avgHeartRate: 158, maxHeartRate: 162, avgCadence: 174 }
    ];
    const records = createMockRecords(1800, 160);
    const result = classifyRun(meta, records, baseEconomy, intervals);
    expect(result.runType).toBe('threshold_lt2');
    expect(result.isFailedWorkout).toBe(true);
  });

  it('classifies identically regardless of absolute pace (multi-athlete safe)', () => {
    // Same HR + structure at much slower absolute paces must yield the same type.
    const fastThreshold: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 300, durationSeconds: 600, distanceMeters: 2500, avgSpeedMps: 4.16, avgPaceSecKm: 240, avgHeartRate: 168, maxHeartRate: 174, avgCadence: 178 },
      { intervalIndex: 2, type: 'recovery', startSeconds: 900, durationSeconds: 120, distanceMeters: 300, avgSpeedMps: 2.5, avgPaceSecKm: 400, avgHeartRate: 140, maxHeartRate: 168, avgCadence: 140 },
      { intervalIndex: 3, type: 'work', startSeconds: 1020, durationSeconds: 600, distanceMeters: 2500, avgSpeedMps: 4.16, avgPaceSecKm: 240, avgHeartRate: 170, maxHeartRate: 176, avgCadence: 178 }
    ];
    const slowThreshold: DetectedInterval[] = fastThreshold.map(i => ({
      ...i,
      distanceMeters: i.type === 'work' ? 1400 : 150,
      avgSpeedMps: 2.2,
      avgPaceSecKm: 455
    }));
    const records = createMockRecords(2000, 160);
    const fastRes = classifyRun(baseMetadata, records, baseEconomy, fastThreshold);
    const slowRes = classifyRun(baseMetadata, records, baseEconomy, slowThreshold);
    expect(fastRes.runType).toBe('threshold_lt2');
    expect(slowRes.runType).toBe('threshold_lt2');
    expect(slowRes.isFailedWorkout).toBe(fastRes.isFailedWorkout);
  });

  it('classifies as long_run when duration >= 110 minutes', () => {
    const meta: ActivityMetadata = {
      ...baseMetadata,
      totalDurationSeconds: 6900, // 115 min
      totalDistanceMeters: 20000 // 20 km
    };
    const records = createMockRecords(6900, 138);
    const result = classifyRun(meta, records, baseEconomy, []);
    expect(result.runType).toBe('long_run');
  });

  it('classifies 75 to 90 min continuous aerobic runs as easy_base', () => {
    const meta: ActivityMetadata = {
      ...baseMetadata,
      totalDurationSeconds: 5400, // 90 min
      totalDistanceMeters: 14000
    };
    const records = createMockRecords(5400, 138);
    const result = classifyRun(meta, records, baseEconomy, []);
    expect(result.runType).toBe('easy_base');
  });

  it('classifies as threshold_lt2 when significant continuous time is spent in Zone 4', () => {
    const meta: ActivityMetadata = {
      ...baseMetadata,
      avgHeartRate: 168,
      maxHeartRate: 185
    };
    // 168 bpm on 185 max HR is solidly in Zone 4 (88%-92%)
    const records = createMockRecords(2400, 168);
    const result = classifyRun(meta, records, baseEconomy, []);
    expect(result.runType).toBe('threshold_lt2');
  });

  it('classifies a short low-HRR jog as recovery', () => {
    const meta: ActivityMetadata = {
      ...baseMetadata,
      totalDurationSeconds: 1500, // 25 min
      totalDistanceMeters: 4000,
      avgHeartRate: 120,
      maxHeartRate: 185
    };
    const records = createMockRecords(1500, 120);
    const result = classifyRun(meta, records, baseEconomy, []);
    expect(result.runType).toBe('recovery');
  });

  it('does not infer recovery intent from a title', () => {
    const meta: ActivityMetadata = {
      ...baseMetadata,
      name: 'Easy Recovery Jog After Long Run',
      totalDurationSeconds: 3600,
      avgHeartRate: 142
    };
    const records = createMockRecords(3600, 142);
    const result = classifyRun(meta, records, baseEconomy, []);
    expect(result.runType).toBe('easy_base');
    expect(result).toEqual(classifyRun({ ...meta, name: '' }, records, baseEconomy, []));
  });

  it('uses the athlete profile for a low-HRR Zone 2 recovery when session max HR is missing', () => {
    const meta: ActivityMetadata = {
      ...baseMetadata,
      avgHeartRate: 135,
      maxHeartRate: 0 // Missing session peak must not replace the athlete's maximum
    };
    const records = createMockRecords(1800, 135);
    const result = classifyRun(meta, records, { ...baseEconomy, aerobicDecouplingPct: null }, [], { maxHr: 190, restingHr: 55, lt1Hr: 148, lt2Hr: 167 });
    expect(result.runType).toBe('recovery');
  });

  it('classifies threshold intervals when zoneDist.z4Pct >= 20 even if work HR is lower', () => {
    const meta = { ...baseMetadata, name: 'Threshold Intervals Mixed' };
    const intervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 300, durationSeconds: 500, distanceMeters: 2000, avgSpeedMps: 4.0, avgPaceSecKm: 250, avgHeartRate: 155, maxHeartRate: 160, avgCadence: 175 }
    ];
    // Create records with 25% zone 4
    const records = [
      ...createMockRecords(900, 130), // 75% Z2
      ...createMockRecords(300, 168)  // 25% Z4
    ];
    const res = classifyRun(meta, records, baseEconomy, intervals);
    expect(res.runType).toBe('threshold_lt2');
  });

  it('classifies vo2 intervals triggered by Zone 5 percentage or peak VO2 HR', () => {
    const meta = { ...baseMetadata, maxHeartRate: 200 };
    const intervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 100, durationSeconds: 180, distanceMeters: 900, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 182, maxHeartRate: 188, avgCadence: 180 },
      { intervalIndex: 2, type: 'recovery', startSeconds: 280, durationSeconds: 60, distanceMeters: 100, avgSpeedMps: 1.6, avgPaceSecKm: 600, avgHeartRate: 140, maxHeartRate: 170, avgCadence: 110 },
      { intervalIndex: 3, type: 'work', startSeconds: 340, durationSeconds: 180, distanceMeters: 900, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 184, maxHeartRate: 189, avgCadence: 180 }
    ];
    const records = createMockRecords(1200, 165);
    const res = classifyRun(meta, records, baseEconomy, intervals);
    expect(res.runType).toBe('intervals_vo2');
  });

  it('does not treat merely crossing LT2 as VO2 intensity', () => {
    const meta = { ...baseMetadata, maxHeartRate: 203, avgHeartRate: 181 };
    const intervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 100, durationSeconds: 180, distanceMeters: 900, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 181, maxHeartRate: 183, avgCadence: 180 },
      { intervalIndex: 2, type: 'recovery', startSeconds: 280, durationSeconds: 60, distanceMeters: 100, avgSpeedMps: 1.6, avgPaceSecKm: 600, avgHeartRate: 150, maxHeartRate: 165, avgCadence: 110 },
      { intervalIndex: 3, type: 'work', startSeconds: 340, durationSeconds: 180, distanceMeters: 900, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 182, maxHeartRate: 184, avgCadence: 180 }
    ];
    const records = createMockRecords(1200, 181);
    const profile = { maxHr: 203, restingHr: 54, lt1Hr: 153, lt2Hr: 179 };

    const result = classifyRun(meta, records, baseEconomy, intervals, profile);

    expect(result.runType).toBe('threshold_lt2');
  });

  it('does not classify surges in a tempo or base run as intervals_vo2', () => {
    // 2 brief surges during a tempo run where peak HR only reaches tempo/Z4 (168 bpm vs max 200)
    const meta = { ...baseMetadata, maxHeartRate: 200, avgHeartRate: 155 };
    const intervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 500, durationSeconds: 60, distanceMeters: 300, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 164, maxHeartRate: 168, avgCadence: 180 },
      { intervalIndex: 2, type: 'recovery', startSeconds: 560, durationSeconds: 120, distanceMeters: 300, avgSpeedMps: 2.5, avgPaceSecKm: 400, avgHeartRate: 148, maxHeartRate: 164, avgCadence: 155 },
      { intervalIndex: 3, type: 'work', startSeconds: 680, durationSeconds: 60, distanceMeters: 300, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 164, maxHeartRate: 168, avgCadence: 180 }
    ];
    const records = createMockRecords(2400, 155);
    const res = classifyRun(meta, records, baseEconomy, intervals);
    expect(res.runType).not.toBe('intervals_vo2');
    expect(res.runType).toBe('easy_base');
    expect(res.reason).toContain('surges');
  });

  it('classifies galloway run/walk sessions as easy_base, never intervals_vo2', () => {
    const meta = { ...baseMetadata, avgHeartRate: 142, maxHeartRate: 165 };
    // 5 walk intervals interspersed in an easy run
    const intervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 0, durationSeconds: 180, distanceMeters: 375, avgSpeedMps: 2.08, avgPaceSecKm: 480, avgHeartRate: 142, maxHeartRate: 148, avgCadence: 158 },
      { intervalIndex: 2, type: 'recovery', startSeconds: 180, durationSeconds: 45, distanceMeters: 50, avgSpeedMps: 1.11, avgPaceSecKm: 900, avgHeartRate: 125, maxHeartRate: 142, avgCadence: 110 },
      { intervalIndex: 3, type: 'work', startSeconds: 225, durationSeconds: 180, distanceMeters: 375, avgSpeedMps: 2.08, avgPaceSecKm: 480, avgHeartRate: 144, maxHeartRate: 149, avgCadence: 158 },
      { intervalIndex: 4, type: 'recovery', startSeconds: 405, durationSeconds: 45, distanceMeters: 50, avgSpeedMps: 1.11, avgPaceSecKm: 900, avgHeartRate: 126, maxHeartRate: 144, avgCadence: 110 },
      { intervalIndex: 5, type: 'work', startSeconds: 450, durationSeconds: 180, distanceMeters: 375, avgSpeedMps: 2.08, avgPaceSecKm: 480, avgHeartRate: 145, maxHeartRate: 150, avgCadence: 158 },
      { intervalIndex: 6, type: 'recovery', startSeconds: 630, durationSeconds: 45, distanceMeters: 50, avgSpeedMps: 1.11, avgPaceSecKm: 900, avgHeartRate: 127, maxHeartRate: 145, avgCadence: 110 },
      { intervalIndex: 7, type: 'work', startSeconds: 675, durationSeconds: 180, distanceMeters: 375, avgSpeedMps: 2.08, avgPaceSecKm: 480, avgHeartRate: 145, maxHeartRate: 150, avgCadence: 158 },
      { intervalIndex: 8, type: 'recovery', startSeconds: 855, durationSeconds: 45, distanceMeters: 50, avgSpeedMps: 1.11, avgPaceSecKm: 900, avgHeartRate: 128, maxHeartRate: 145, avgCadence: 110 }
    ];
    const records = createMockRecords(1800, 142);
    const res = classifyRun(meta, records, baseEconomy, intervals, { lt1Hr: 145, lt2Hr: 165, maxHr: 180 });
    expect(res.runType).toBe('easy_base');
    expect(res.reason).toContain('Galloway');
  });

  it('allows a short Zone 2 run with low HRR and no LT1 exposure to be recovery', () => {
    // HR 140 is above Zone 1 but only 58.6% of the athlete's HR reserve.
    const meta = { ...baseMetadata, maxHeartRate: 200, avgHeartRate: 140, totalDurationSeconds: 1800 };
    const records = createMockRecords(1800, 140);
    const res = classifyRun(meta, records, baseEconomy, [], { maxHr: 200, restingHr: 55 });
    expect(res.runType).toBe('recovery');
  });

  describe('running-dose recovery criteria', () => {
    const profile = { maxHr: 200, restingHr: 50, lt1Hr: 153, lt2Hr: 175 };
    const classify = (records: ActivityRecord[], durationSeconds = records.at(-1)!.elapsedSeconds) =>
      classifyRun({ ...baseMetadata, totalDurationSeconds: durationSeconds, avgHeartRate: 100 }, records, baseEconomy, [], profile);

    it('recovers the 27-minute boundary case with only about 30% Zone 1', () => {
      const records = createMockRecords(1621, 133);
      records.forEach((record, i) => { record.heartRate = i < 486 ? 130 : i < 1587 ? 135 : 142; });
      expect(classify(records).runType).toBe('recovery');
    });

    it.each([50, 75, 90, 110])('respects running dose at %i minutes', minutes => {
      expect(classify(createMockRecords(minutes * 60 + 1, 135)).runType)
        .toBe(minutes <= 50 ? 'recovery' : minutes >= 110 ? 'long_run' : 'easy_base');
    });

    it('rejects recovery one second past the 50-minute running limit', () => {
      expect(classify(createMockRecords(3002, 135)).runType).toBe('easy_base');
    });

    it.each([100, 101])('enforces the exact 10%% HRR exposure cutoff (%i seconds)', seconds => {
      const records = createMockRecords(1001, 130);
      const boundary = 1000 - seconds;
      records.forEach((record, i) => {
        if (i === boundary) record.heartRate = 140;
        if (i > boundary) record.heartRate = 150;
      });
      expect(classify(records).runType).toBe(seconds === 100 ? 'recovery' : 'easy_base');
    });

    it.each([10, 11])('enforces the exact 1%% LT1 exposure cutoff (%i seconds)', seconds => {
      const records = createMockRecords(1001, 130);
      records.forEach((record, i) => { if (i >= 1000 - seconds) record.heartRate = profile.lt1Hr; });
      expect(classify(records).runType).toBe(seconds === 10 ? 'recovery' : 'easy_base');
    });

    it('accepts exactly 60% HRR and rejects a higher average independently of exposure', () => {
      expect(classify(createMockRecords(1001, 140)).runType).toBe('recovery');
      const records = createMockRecords(1001, 139);
      records.forEach((record, i) => { if (i >= 901) record.heartRate = 152; });
      expect(classify(records).runType).toBe('easy_base');
    });

    it.each([100, 110])('limits above-60%% HRR exposure to 10%% (%i seconds)', seconds => {
      const records = createMockRecords(1001, 130);
      records.forEach((record, i) => { if (i >= 1001 - seconds) record.heartRate = 150; });
      expect(classify(records).runType).toBe(seconds === 100 ? 'recovery' : 'easy_base');
    });

    it.each([10, 20])('counts HR exactly at LT1 toward the 1%% limit (%i seconds)', seconds => {
      const records = createMockRecords(1001, 130);
      records.forEach((record, i) => { if (i >= 1001 - seconds) record.heartRate = profile.lt1Hr; });
      expect(classify(records).runType).toBe(seconds === 10 ? 'recovery' : 'easy_base');
    });

    it('does not let low-HR walking or stops dilute hard running', () => {
      const records = createMockRecords(1801, 100);
      records.forEach((record, i) => {
        record.cadence = i < 600 ? 0 : i < 1200 ? 110 : 165;
        record.speedMps = i < 600 ? 0 : i < 1200 ? 1.2 : 3.3;
        if (i >= 1200) record.heartRate = 150;
      });
      expect(classify(records).runType).toBe('easy_base');
    });

    it('uses running duration even when walking extends total duration beyond 50 minutes', () => {
      const records = createMockRecords(3601, 130);
      records.forEach((record, i) => { if (i <= 600) { record.cadence = 110; record.speedMps = 1.2; } });
      expect(classify(records).runType).toBe('recovery');
    });

    it('weights irregular samples by duration and excludes long recording gaps', () => {
      const records = createMockRecords(1001, 130).filter((_, i) => i <= 900 ? i % 10 === 0 : true);
      records.forEach(record => { if (record.elapsedSeconds > 900) record.heartRate = 150; });
      expect(classify(records).runType).toBe('recovery');
      const sparse = createMockRecords(3601, 130).filter((_, i) => i % 60 === 0);
      expect(classify(sparse).runType).toBe('easy_base');
    });

    it('requires valid running HR evidence', () => {
      const records = createMockRecords(1001, 130);
      records.forEach(record => { record.heartRate = null; });
      expect(classify(records).runType).toBe('easy_base');
      expect(classifyRun(baseMetadata, [], baseEconomy, [], profile).runType).toBe('easy_base');
    });
  });

  it('handles empty activity name and non-recovery low maxHr gracefully', () => {
    // metadata.name is empty string, avgHr is 150 (not recovery), maxHr is 0
    const meta: ActivityMetadata = {
      ...baseMetadata,
      name: '',
      avgHeartRate: 150,
      maxHeartRate: 0
    };
    const records = createMockRecords(1800, 150);
    const result = classifyRun(meta, records, baseEconomy, []);
    expect(result.runType).toBe('easy_base');
  });

  it('defaults to easy_base for standard aerobic running with undefined decoupling', () => {
    // HR 145 is above recovery ceiling
    const meta: ActivityMetadata = { ...baseMetadata, avgHeartRate: 145 };
    const records = createMockRecords(2400, 145);
    const result = classifyRun(meta, records, { ...baseEconomy, aerobicDecouplingPct: undefined as any }, []);
    expect(result.runType).toBe('easy_base');
    expect(result.reason).toContain('decoupling 0%');
  });
});
