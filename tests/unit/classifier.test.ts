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

  it('classifies as race / benchmark when title contains race keywords', () => {
    const titles = ['5k Time Trial', 'Morning 10k TT', 'Sunday Race Day', 'Bedok Reservoir Parkrun'];
    for (const name of titles) {
      const meta = { ...baseMetadata, name };
      const records = createMockRecords(1200, 175);
      const res = classifyRun(meta, records, baseEconomy, []);
      expect(res.runType).toBe('race');
      expect(res.confidence).toBe(0.95);
    }
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
    const resFlat = classifyRun(baseMetadata, recs, baseEconomy, flatIntervals);
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

  it('classifies as recovery when short duration (<=50 min) and low HR (<72% max HR)', () => {
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

  it('classifies as recovery when title explicitly includes recovery keyword', () => {
    const meta: ActivityMetadata = {
      ...baseMetadata,
      name: 'Easy Recovery Jog After Long Run',
      totalDurationSeconds: 3600,
      avgHeartRate: 142
    };
    const records = createMockRecords(3600, 142);
    const result = classifyRun(meta, records, baseEconomy, []);
    expect(result.runType).toBe('recovery');
    expect(result.reason).toContain('Recovery run identified by title');
  });

  it('handles low maxHeartRate fallback (< 120) and null decoupling gracefully', () => {
    const meta: ActivityMetadata = {
      ...baseMetadata,
      avgHeartRate: 135,
      maxHeartRate: 0 // Will fallback to 185
    };
    const records = createMockRecords(1800, 135);
    const result = classifyRun(meta, records, { ...baseEconomy, aerobicDecouplingPct: null }, []);
    expect(result.runType).toBe('recovery'); // 135 <= 136 and duration 30m <= 50m
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

  it('classifies vo2 intervals triggered by Zone 5 percentage or avgWorkHr', () => {
    const meta = { ...baseMetadata, maxHeartRate: 200 };
    const intervals: DetectedInterval[] = [
      { intervalIndex: 1, type: 'work', startSeconds: 100, durationSeconds: 120, distanceMeters: 600, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 166, maxHeartRate: 168, avgCadence: 180 }, // avgWorkHr >= 200 * 0.82 (164)
      { intervalIndex: 2, type: 'recovery', startSeconds: 220, durationSeconds: 60, distanceMeters: 100, avgSpeedMps: 1.6, avgPaceSecKm: 600, avgHeartRate: 140, maxHeartRate: 160, avgCadence: 110 },
      { intervalIndex: 3, type: 'work', startSeconds: 280, durationSeconds: 120, distanceMeters: 600, avgSpeedMps: 5.0, avgPaceSecKm: 200, avgHeartRate: 166, maxHeartRate: 168, avgCadence: 180 }
    ];
    const records = createMockRecords(600, 150);
    const res = classifyRun(meta, records, baseEconomy, intervals);
    expect(res.runType).toBe('intervals_vo2');
  });

  it('classifies recovery based on maxHr * 0.72 ceiling when avg HR > 136', () => {
    // maxHr = 200, 72% is 144. HR 140 is > 136 bpm but < 144 bpm
    const meta = { ...baseMetadata, maxHeartRate: 200, avgHeartRate: 140, totalDurationSeconds: 1800 };
    const records = createMockRecords(1800, 140);
    const res = classifyRun(meta, records, baseEconomy, []);
    expect(res.runType).toBe('recovery');
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
