import { describe, expect, it } from 'vitest';
import { classifyRun, type RunType } from '../../src/backend/ingestion/classifier.js';
import type { ActivityMetadata, ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';
import { detectIntervals } from '../../src/backend/ingestion/interval-detector.js';
import { calculateEconomy } from '../../src/backend/physiology/economy.js';
import { buildSessionTags } from '../../src/backend/ingestion/session-tags.js';

const profiles = [
  { maxHr: 160, restingHr: 45, lt1Hr: 118, lt2Hr: 139 },
  { maxHr: 200, restingHr: 50, lt1Hr: 148, lt2Hr: 173 },
  { maxHr: 225, restingHr: 65, lt1Hr: 170, lt2Hr: 196 }
];
interface Block { seconds: number; hr: number; cadence: number; speed: number }

function recording(blocks: Block[], sampling: number[]): ActivityRecord[] {
  const rows: ActivityRecord[] = [];
  let elapsed = 0;
  let distance = 0;
  for (const block of blocks) {
    const end = elapsed + block.seconds;
    while (elapsed < end) {
      rows.push({ timestamp: new Date(Date.UTC(2026, 0, 1) + elapsed * 1000).toISOString(),
        elapsedSeconds: elapsed, heartRate: block.hr, cadence: block.cadence,
        speedMps: block.speed, distanceMeters: distance, altitudeMeters: 0,
        latitude: null, longitude: null, temperature: null, verticalOscillation: null, stanceTime: null });
      const dt = Math.min(end - elapsed, sampling[(rows.length - 1) % sampling.length]);
      elapsed += dt;
      distance += block.speed * dt;
    }
  }
  rows.push({ ...rows.at(-1)!, elapsedSeconds: elapsed, distanceMeters: distance });
  return rows;
}

function analyze(records: ActivityRecord[], profile: typeof profiles[number]) {
  let hrSeconds = 0;
  for (let index = 0; index < records.length - 1; index++) {
    hrSeconds += (records[index].heartRate ?? 0) * (records[index + 1].elapsedSeconds - records[index].elapsedSeconds);
  }
  const duration = records.at(-1)!.elapsedSeconds - records[0].elapsedSeconds;
  const metadata: ActivityMetadata = {
    id: 'robustness', name: '', sport: 'running', date: '2026-01-01',
    totalDistanceMeters: records.at(-1)!.distanceMeters ?? 0,
    totalDurationSeconds: duration, totalElapsedSeconds: duration,
    avgHeartRate: Math.round(hrSeconds / duration),
    maxHeartRate: Math.max(...records.map(record => record.heartRate ?? 0)),
    avgCadence: 170, maxCadence: 190, calories: 0, totalAscentMeters: 0, totalDescentMeters: 0
  };
  let intervals = detectIntervals(records, profile);
  const classification = classifyRun(metadata, records, calculateEconomy(records), intervals, profile);
  if (classification.runType === 'race') intervals = detectIntervals(records, { ...profile, isRace: true });
  return { classification, intervals, tags: buildSessionTags(classification.runType, records, intervals, profile) };
}

describe('Classifier robustness across independent recording variations', () => {
  it.each(profiles)('classifies 20m warmup / 60m tempo / 20m cooldown as tempo: %j', profile => {
    const easyHr = profile.lt1Hr - 12;
    const tempoHr = Math.round((profile.lt1Hr + profile.lt2Hr - 5) / 2);
    for (const speed of [2, 4]) {
      for (const sampling of [[1], [5], [1, 8, 3, 2, 5]]) {
        const records = recording([
          { seconds: 1200, hr: easyHr, cadence: 170, speed },
          { seconds: 3600, hr: tempoHr, cadence: 184, speed: speed * 1.3 },
          { seconds: 1200, hr: easyHr, cadence: 170, speed }
        ], sampling);
        const result = analyze(records, profile);
        expect(result.classification.runType).toBe('tempo');
        expect(result.classification.evidence.ruleId).toBe('structured_tempo');
        expect(result.tags).toEqual(['Tempo']);
        // Easy warmup walk breaks must not trigger the aerobic run/walk rule
        // ahead of the sustained work block, as happened in the reported run.
        const withWalks = records.map(record => [100, 300, 500, 700].some(start =>
          record.elapsedSeconds >= start && record.elapsedSeconds < start + 20)
          ? { ...record, cadence: 110, speedMps: 1.2 } : record);
        expect(analyze(withWalks, profile).classification.runType).toBe('tempo');
        const easy = analyze(recording([{ seconds: 5400, hr: easyHr, cadence: 170, speed }], sampling), profile);
        expect(easy.classification.runType).toBe('easy_base');
      }
    }
  });

  it.each(profiles)('preserves the workout family across pace and sampling changes: %j', profile => {
    const reserve = profile.maxHr - profile.restingHr;
    const recoveryHr = Math.round(profile.restingHr + reserve * 0.40);
    const easyHr = Math.round(profile.restingHr + reserve * 0.60);
    const raceHr = Math.round(profile.restingHr + reserve * 0.94);
    for (const speed of [2, 4.5]) {
      const easy: Block = { seconds: 300, hr: easyHr, cadence: 155, speed };
      const cases: { expected: RunType; blocks: Block[] }[] = [
        { expected: 'recovery', blocks: [{ ...easy, seconds: 1500, hr: recoveryHr }] },
        { expected: 'easy_base', blocks: [{ ...easy, seconds: 3600 }] },
        { expected: 'long_run', blocks: [{ ...easy, seconds: 7200 }] },
        { expected: 'race', blocks: [easy, { seconds: 1200, hr: raceHr, cadence: 180, speed: speed * 1.4 }, easy] },
        { expected: 'threshold_lt2', blocks: [easy, ...Array.from({ length: 3 }, () => [
          { seconds: 600, hr: profile.lt2Hr, cadence: 180, speed: speed * 1.2 },
          { seconds: 120, hr: easyHr, cadence: 120, speed: speed * 0.7 }
        ]).flat(), easy] },
        { expected: 'intervals_vo2', blocks: [easy, ...Array.from({ length: 5 }, () => [
          { seconds: 180, hr: raceHr, cadence: 185, speed: speed * 1.5 },
          { seconds: 120, hr: easyHr, cadence: 120, speed: speed * 0.7 }
        ]).flat(), easy] }
      ];
      for (const scenario of cases) {
        for (const sampling of [[1], [5], [1, 8, 3, 2, 5]]) {
          const result = analyze(recording(scenario.blocks, sampling), profile);
          expect(result.classification.runType, `${scenario.expected}, speed ${speed}, samples ${sampling}`).toBe(scenario.expected);
          expect(result.classification.isFailedWorkout ?? false).toBe(false);
        }
      }
    }
  });

  it.each(profiles)('keeps VO2 reps separate despite elevated recovery HR, including missing speed: %j', profile => {
    const reserve = profile.maxHr - profile.restingHr;
    const easyHr = Math.round(profile.restingHr + reserve * 0.60);
    const hardHr = Math.round(profile.restingHr + reserve * 0.94);
    const blocks = [{ seconds: 300, hr: easyHr, cadence: 155, speed: 3 },
      ...Array.from({ length: 5 }, () => [
        { seconds: 180, hr: hardHr, cadence: 185, speed: 4.5 },
        { seconds: 120, hr: profile.lt2Hr + 5, cadence: 150, speed: 2 }
      ]).flat(), { seconds: 300, hr: easyHr, cadence: 155, speed: 3 }];
    for (const sampling of [[1], [5], [1, 8, 3, 2, 5]]) {
      for (const missingSpeed of [false, true]) {
        const records = recording(blocks, sampling);
        if (missingSpeed) for (const record of records) record.speedMps = null;
        const result = analyze(records, profile);
        expect(result.intervals.filter(interval => interval.type === 'work'), `samples ${sampling}, speed missing ${missingSpeed}`).toHaveLength(5);
        expect(result.classification.runType).toBe('intervals_vo2');
      }
    }
  });

  it('preserves the classification when the recording clock has an offset', () => {
    const blocks = [{ seconds: 300, hr: 140, cadence: 155, speed: 3 },
      { seconds: 1200, hr: 192, cadence: 180, speed: 4.5 },
      { seconds: 300, hr: 140, cadence: 155, speed: 3 }];
    const records = recording(blocks, [1, 8, 3]);
    const baseline = analyze(records, profiles[1]);
    const shifted = analyze(records.map(record => ({ ...record, elapsedSeconds: record.elapsedSeconds + 86400 })), profiles[1]);
    expect(shifted.classification).toEqual(baseline.classification);
    expect(shifted.tags).toEqual(baseline.tags);
  });

  it('does not turn a short hard finish inside an otherwise aerobic run into a race', () => {
    const result = analyze(recording([
      { seconds: 3300, hr: 140, cadence: 170, speed: 3 },
      { seconds: 180, hr: 195, cadence: 185, speed: 4.5 },
      { seconds: 120, hr: 140, cadence: 170, speed: 3 }
    ], [1, 5, 3]), profiles[1]);
    expect(result.classification.runType).toBe('easy_base');
  });

  it.each(profiles)('preserves three preparation strides around a faster race and keeps its finishing surge intact: %j', profile => {
    const easyHr = Math.round(profile.restingHr + (profile.maxHr - profile.restingHr) * 0.60);
    const raceHr = Math.round(profile.restingHr + (profile.maxHr - profile.restingHr) * 0.94);
    const easy = { seconds: 900, hr: easyHr, cadence: 170, speed: 2.5 };
    const walk = { seconds: 60, hr: easyHr, cadence: 100, speed: 1.2 };
    for (const raceSpeed of [3.8, 5]) {
      for (const cooldownStrides of [false, true]) {
        for (const sampling of [[1], [5], [1, 4, 2, 3]]) {
          const records = recording([easy, walk,
            ...Array.from({ length: 3 }, () => [
              { seconds: 4, hr: easyHr, cadence: 0, speed: 4 },
              { seconds: 16, hr: easyHr + 5, cadence: 196, speed: 4 }, walk
            ]).flat(),
            { seconds: 1180, hr: raceHr, cadence: 185, speed: raceSpeed },
            { seconds: 20, hr: raceHr, cadence: 205, speed: raceSpeed * 1.3 },
            walk, easy,
            ...(cooldownStrides ? [{ seconds: 20, hr: easyHr, cadence: 196, speed: 4 }, walk] : [])
          ], sampling);
          const result = analyze(records, profile);
          expect(result.classification.runType).toBe('race');
          const work = result.intervals.filter(interval => interval.type === 'work');
          expect(work).toHaveLength(1);
          expect(work[0].durationSeconds).toBeGreaterThanOrEqual(1195);
          const strides = result.intervals.filter(interval => interval.type === 'stride');
          expect(strides, `race speed ${raceSpeed}, sampling ${sampling}, cooldown ${cooldownStrides}`).toHaveLength(cooldownStrides ? 4 : 3);
          expect(strides.slice(0, 3).every(stride => stride.startSeconds < work[0].startSeconds)).toBe(true);
          expect(result.tags).toEqual(['Race', 'Strides']);
        }
      }
    }
  });

  it('validates a short calibrated burst after capturing deceleration, and still rejects stationary sensor spikes', () => {
    for (const sampling of [[1], [2], [5], [1, 4, 2, 3]]) {
      const records = recording([
        { seconds: 900, hr: 140, cadence: 170, speed: 2.5 },
        { seconds: 60, hr: 130, cadence: 100, speed: 1.2 },
        { seconds: 8, hr: 135, cadence: 196, speed: 4.5 },
        { seconds: 4, hr: 145, cadence: 94, speed: 2.8 },
        { seconds: 60, hr: 140, cadence: 100, speed: 1.2 },
        { seconds: 1200, hr: 192, cadence: 185, speed: 4.8 },
        { seconds: 60, hr: 150, cadence: 100, speed: 1.2 }
      ], sampling);
      const options = { ...profiles[1], isRace: true, stridePaceAnchorSecKm: 1000 / 4.3 };
      const strides = detectIntervals(records, options).filter(interval => interval.type === 'stride');
      expect(strides, `sampling ${sampling}`).toHaveLength(1);
      expect(strides[0].durationSeconds).toBeGreaterThanOrEqual(8);
      expect(strides[0].distanceMeters).toBeGreaterThanOrEqual(25);
      // The fast core exceeds the calibrated anchor even though including the
      // deceleration can pull the complete stride's average below that anchor.
      expect(strides[0].peakSpeedMps).toBeGreaterThan(4.3);
      const stationary = records.map(record => ({ ...record,
        distanceMeters: record.elapsedSeconds >= 960 && record.elapsedSeconds <= 972
          ? records.find(sample => sample.elapsedSeconds === 960)!.distanceMeters
          : record.distanceMeters }));
      expect(detectIntervals(stationary, options).filter(interval => interval.type === 'stride')).toEqual([]);
    }
  });

  it.each(profiles)('distinguishes strides from identical long-run surges using the following recovery: %j', profile => {
    const easyHr = Math.round(profile.restingHr + (profile.maxHr - profile.restingHr) * 0.60);
    for (const speed of [2, 3.5]) {
      for (const sampling of [[1], [5], [1, 4, 2, 3]]) {
        for (const walking of [false, true]) {
          const easy = { seconds: 3600, hr: easyHr, cadence: 170, speed };
          const records = recording([easy,
            ...Array.from({ length: 3 }, () => [
              { seconds: 20, hr: easyHr, cadence: 196, speed: speed * 1.5 },
              { seconds: 20, hr: easyHr + 8, cadence: walking ? 100 : 170, speed: walking ? 1.2 : speed },
              { seconds: 40, hr: easyHr, cadence: walking ? 100 : 170, speed: walking ? 1.2 : speed }
            ]).flat(), { ...easy, seconds: 3400 }
          ], sampling);
          const result = analyze(records, profile);
          expect(result.classification.runType).toBe('long_run');
          expect(result.intervals.filter(interval => interval.type === 'stride'), `speed ${speed}, samples ${sampling}, walking ${walking}`).toHaveLength(walking ? 3 : 0);
          expect(result.tags.includes('Strides')).toBe(walking);
        }
      }
    }
  });

  it('requires sustained prompt walking, rather than a stoplight flutter, slow jog, or incomplete recording', () => {
    const easy = { seconds: 900, hr: 140, cadence: 170, speed: 2.5 };
    const burst = { seconds: 20, hr: 140, cadence: 196, speed: 4.5 };
    const walk = { seconds: 60, hr: 155, cadence: 100, speed: 1.2 };
    const cases = [
      { name: 'walking', blocks: [walk], expected: 1 },
      { name: 'two seconds of walking', blocks: [{ ...walk, seconds: 2 }, easy], expected: 0 },
      { name: 'walking only after resumed running', blocks: [{ ...easy, seconds: 30 }, walk], expected: 0 },
      { name: 'slow jogging', blocks: [{ ...walk, cadence: 170, speed: 1.6 }], expected: 0 },
      { name: 'fast movement despite low cadence', blocks: [{ ...walk, speed: 2.4 }], expected: 0 },
      { name: 'no following records', blocks: [], expected: 0 }
    ];
    for (const scenario of cases) {
      for (const sampling of [[1], [5], [1, 4, 2, 3]]) {
        const records = recording([easy, burst, ...scenario.blocks], sampling);
        expect(detectIntervals(records, profiles[1]).filter(interval => interval.type === 'stride'), `${scenario.name}, samples ${sampling}`).toHaveLength(scenario.expected);
      }
    }
  });

  it('keeps stride boundaries independent of delayed or missing HR and validates recovery sensor evidence', () => {
    const records = recording([
      { seconds: 900, hr: 140, cadence: 170, speed: 2.5 },
      { seconds: 20, hr: 142, cadence: 196, speed: 4.5 },
      { seconds: 20, hr: 170, cadence: 100, speed: 1.2 },
      { seconds: 40, hr: 145, cadence: 100, speed: 1.2 },
      { seconds: 900, hr: 140, cadence: 170, speed: 2.5 }
    ], [1, 4, 2, 3]);
    const read = (rows: ActivityRecord[]) => detectIntervals(rows, profiles[1])
      .filter(interval => interval.type === 'stride').map(interval => ({ start: interval.startSeconds, duration: interval.durationSeconds }));
    const baseline = read(records);
    expect(baseline).toHaveLength(1);
    expect(baseline[0].duration).toBeLessThanOrEqual(20);
    for (const hr of [null, 140]) expect(read(records.map(record => ({ ...record, heartRate: hr })))).toEqual(baseline);
    for (const missing of ['cadence', 'speedMps'] as const) {
      expect(read(records.map(record => record.elapsedSeconds >= 920 && record.elapsedSeconds < 980
        ? { ...record, [missing]: null } : record))).toEqual(baseline);
    }
    expect(read(records.map(record => record.elapsedSeconds >= 920 && record.elapsedSeconds < 980
      ? { ...record, cadence: null, speedMps: null } : record))).toEqual([]);
    // A long unrecorded pause cannot stand in for observed walking recovery.
    expect(read(records.filter(record => record.elapsedSeconds < 920 || record.elapsedSeconds >= 945))).toEqual([]);
  });
});
