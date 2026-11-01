import { describe, expect, it } from 'vitest';
import { detectIntervals } from '../../src/backend/ingestion/interval-detector.js';
import { classifyRun } from '../../src/backend/ingestion/classifier.js';
import { buildSessionTags } from '../../src/backend/ingestion/session-tags.js';
import { calculateEconomy } from '../../src/backend/physiology/economy.js';
import { gradeRun } from '../../src/backend/physiology/coach-rubric.js';
import type { ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';

const profile = { lt1Hr: 144, lt2Hr: 178, maxHr: 203, restingHr: 54 };

interface Leg { seconds: number; speed: number; hr: number; cadence: number }

/**
 * Build a recording from consecutive legs. `gapSeconds` drops telemetry for that
 * long immediately before the next leg, which is how a watch pause or a lost
 * sample run appears in the trace.
 */
function recording(legs: Array<Leg & { gapSeconds?: number }>, step = 1): ActivityRecord[] {
  const rows: ActivityRecord[] = [];
  let elapsed = 0;
  let distance = 0;
  for (const leg of legs) {
    for (let t = 0; t < leg.seconds; t += step) {
      distance += leg.speed * step;
      rows.push({
        timestamp: new Date(Date.UTC(2026, 10, 1, 9, 0, elapsed)).toISOString(),
        elapsedSeconds: elapsed, heartRate: leg.hr, cadence: leg.cadence,
        speedMps: leg.speed, distanceMeters: distance, altitudeMeters: 5,
        latitude: null, longitude: null, temperature: 26
      } as ActivityRecord);
      elapsed += step;
    }
    // The break happens after the leg, so the first dropped sample is at `elapsed`.
    elapsed += leg.gapSeconds ?? 0;
  }
  return rows;
}

function metadata(records: ActivityRecord[], seconds: number) {
  return {
    id: 'synthetic', name: 'Running', sport: 'running', date: '2026-11-01 09:00:00',
    totalDistanceMeters: records.at(-1)!.distanceMeters!, totalDurationSeconds: seconds,
    totalElapsedSeconds: seconds, avgHeartRate: 150, maxHeartRate: 176,
    avgCadence: 180, maxCadence: 190, calories: 900,
    totalAscentMeters: 0, totalDescentMeters: 0
  } as any;
}

/** 30 min easy, 90 min at marathon pace with two recording breaks inside it, 10 min easy. */
const marathonPaceLongRun = () => recording([
  { seconds: 1800, speed: 2.45, hr: 138, cadence: 168 },
  { seconds: 1200, speed: 3.13, hr: 166, cadence: 185, gapSeconds: 75 },
  { seconds: 2000, speed: 3.13, hr: 168, cadence: 186, gapSeconds: 60 },
  { seconds: 2200, speed: 3.13, hr: 170, cadence: 186 },
  { seconds: 600, speed: 2.55, hr: 145, cadence: 170 }
]);

describe('Marathon-pace long run', () => {
  it('keeps a sustained block that a recording break cuts in two', () => {
    const records = marathonPaceLongRun();
    const intervals = detectIntervals(records, profile);
    const work = intervals.filter(i => i.type === 'work');
    const workSeconds = work.reduce((sum, i) => sum + i.durationSeconds, 0);
    // The 90-minute block is recorded as easy / block / block / block / easy.
    // Judged per fragment the middle block has no warmup or cooldown to contrast
    // against, so it used to disappear entirely.
    expect(work.length).toBeGreaterThan(0);
    expect(workSeconds).toBeGreaterThan(80 * 60);
    expect(records.at(-1)!.distanceMeters).toBeGreaterThan(0);
  });

  it.each([1, 5])('survives coarse sampling at %ss', step => {
    const records = recording([
      { seconds: 1800, speed: 2.45, hr: 138, cadence: 168 },
      { seconds: 1200, speed: 3.13, hr: 166, cadence: 185, gapSeconds: 75 },
      { seconds: 2000, speed: 3.13, hr: 168, cadence: 186, gapSeconds: 60 },
      { seconds: 2200, speed: 3.13, hr: 170, cadence: 186 },
      { seconds: 600, speed: 2.55, hr: 145, cadence: 170 }
    ], step);
    const workSeconds = detectIntervals(records, profile)
      .filter(i => i.type === 'work').reduce((sum, i) => sum + i.durationSeconds, 0);
    expect(workSeconds).toBeGreaterThan(80 * 60);
  });

  it('classifies as a long run and derives the marathon-pace tag', () => {
    const records = marathonPaceLongRun();
    const intervals = detectIntervals(records, profile);
    const duration = records.at(-1)!.elapsedSeconds + 1;
    const classification = classifyRun(metadata(records, duration), records, calculateEconomy(records), intervals, profile);
    expect(classification.runType).toBe('long_run');
    expect(classification.evidence.ruleId).toBe('long_run_with_marathon_pace');
    expect(buildSessionTags('long_run', records, intervals, profile)).toEqual(['Long Run', 'Marathon Pace']);
  });

  it('grades the block as sustained work instead of an aerobic over-intensity failure', () => {
    const records = marathonPaceLongRun();
    const intervals = detectIntervals(records, profile);
    const result = gradeRun({
      runType: 'marathon_pace', isFailedWorkout: false, isAccidentalTempo: false,
      steadyHr: 163, steadyCadence: 184, steadyStanceTime: 240, decouplingPct: 2,
      lt1Hr: profile.lt1Hr, lt2Hr: profile.lt2Hr, restingHr: profile.restingHr,
      maxHr: profile.maxHr, maxHeartRate: profile.maxHr, activityMaxHr: 176,
      ambientTempC: 26, durationMin: 130, records, intervals
    } as any);
    expect(result.verdict).toBe('on_track');
    expect(result.factors.some(f => f.categoryId === 'aerobic_intensity')).toBe(false);
    expect(result.factors.find(f => f.categoryId === 'sustained_intensity')?.points).toBeGreaterThan(0);
  });

  it('leaves a two-hour tempo session classified as tempo', () => {
    // 20 min easy / 60 min tempo / 20 min easy: quality fills most of the session.
    const records = recording([
      { seconds: 1200, speed: 2.45, hr: 132, cadence: 168 },
      { seconds: 3600, speed: 3.05, hr: 159, cadence: 184 },
      { seconds: 1200, speed: 2.45, hr: 132, cadence: 168 }
    ]);
    const intervals = detectIntervals(records, profile);
    const classification = classifyRun(metadata(records, 6000), records, calculateEconomy(records), intervals, profile);
    expect(classification.runType).toBe('tempo');
    expect(buildSessionTags(classification.runType, records, intervals, profile)).toEqual(['Tempo']);
  });

  it('does not tag an easy long run that carries no marathon-pace block', () => {
    const records = recording([
      { seconds: 3600, speed: 2.45, hr: 138, cadence: 168 },
      { seconds: 3600, speed: 2.5, hr: 142, cadence: 170 }
    ]);
    const intervals = detectIntervals(records, profile);
    expect(buildSessionTags('long_run', records, intervals, profile)).toEqual(['Long Run']);
  });
});
