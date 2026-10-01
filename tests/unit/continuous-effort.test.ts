import { describe, expect, it } from 'vitest';
import type { ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';
import { continuousRaceEffort } from '../../src/backend/ingestion/continuous-effort.js';

const profile = { maxHr: 200, restingHr: 50, lt2Hr: 175 };
function trace(blocks: [number, number][], step = 1): ActivityRecord[] {
  const rows: ActivityRecord[] = [];
  let elapsedSeconds = 0;
  for (const [seconds, hr] of blocks) {
    for (let t = 0; t < seconds; t += step) {
      rows.push({ elapsedSeconds, heartRate: hr, cadence: 170 } as ActivityRecord);
      elapsedSeconds += step;
    }
  }
  return rows;
}

describe('Continuous race-intensity evidence', () => {
  it.each([1, 3, 5])('isolates an effort from a long warmup and cooldown at %is sampling', step => {
    const records = trace([[2100, 140], [1200, 190], [600, 145]], step);
    expect(continuousRaceEffort(records, profile)).toMatchObject({ durationSeconds: 1200, nearMaxPct: 100 });
  });

  it.each([
    { maxHr: 180, restingHr: 45, lt2Hr: 160 },
    { maxHr: 220, restingHr: 65, lt2Hr: 195 }
  ])('scales intensity to each athlete profile: %j', athlete => {
    const hardHr = Math.ceil(athlete.restingHr + (athlete.maxHr - athlete.restingHr) * 0.94);
    expect(continuousRaceEffort(trace([[900, hardHr]]), athlete)).not.toBeNull();
  });

  it('keeps continuous threshold work and gradual threshold drift out of the race family', () => {
    expect(continuousRaceEffort(trace([[1800, 178]]), profile)).toBeNull();
    expect(continuousRaceEffort(trace([[900, 174], [600, 180], [300, 187]]), profile)).toBeNull();
  });

  it('rejects repeated VO2 reps and long over-intense threshold reps', () => {
    expect(continuousRaceEffort(trace([[300, 190], [120, 150], [300, 190], [120, 150], [300, 190]]), profile)).toBeNull();
    expect(continuousRaceEffort(trace([[600, 190], [120, 150], [600, 190]]), profile)).toBeNull();
  });

  it('rejects brief spikes and a short finish surge', () => {
    expect(continuousRaceEffort(trace([[1200, 140], [20, 195], [1200, 140]]), profile)).toBeNull();
    expect(continuousRaceEffort(trace([[1200, 178], [120, 195]]), profile)).toBeNull();
  });

  it('tolerates short HR dips without merging distinct efforts', () => {
    expect(continuousRaceEffort(trace([[600, 190], [15, 170], [600, 190]]), profile)).not.toBeNull();
    expect(continuousRaceEffort(trace([[600, 190], [90, 170], [600, 190]]), profile)).toBeNull();
  });

  it('does not treat unobserved recording gaps or invalid HR as sustained work', () => {
    const sparse = trace([[900, 190]], 60);
    expect(continuousRaceEffort(sparse, profile)).toBeNull();
    expect(continuousRaceEffort(trace([[900, 250]]), profile)).toBeNull();
    const records = trace([[1200, 190]]);
    for (let i = 400; i < 900; i++) records[i].heartRate = null;
    expect(continuousRaceEffort(records, profile)).toBeNull();
  });

  it.each([[479, false], [480, true], [481, true]])('checks the minimum sustained duration at %is', (seconds, expected) => {
    expect(continuousRaceEffort(trace([[seconds, 190], [60, 140]]), profile) !== null).toBe(expected);
  });

  it.each([[30, true], [31, false]])('separates efforts at a %is recovery boundary', (seconds, expected) => {
    expect(continuousRaceEffort(trace([[600, 190], [seconds, 170], [600, 190]]), profile) !== null).toBe(expected);
  });

  it.each([[270, true], [271, false]])('checks dominance against a separate %is hard bout', (seconds, expected) => {
    expect(continuousRaceEffort(trace([[1080, 190], [120, 140], [seconds, 190], [60, 140]]), profile) !== null).toBe(expected);
  });

  it('tolerates brief HR/cadence dropouts but does not treat a long stop as continuous effort', () => {
    const records = trace([[1200, 190], [60, 140]]);
    for (let index = 400; index < 410; index++) { records[index].heartRate = null; records[index].cadence = 0; }
    expect(continuousRaceEffort(records, profile)).not.toBeNull();
    for (let index = 400; index < 520; index++) records[index].cadence = 0;
    expect(continuousRaceEffort(records, profile)).toBeNull();
  });

  it('ignores duplicate, reversed and non-finite timestamps rather than inventing duration', () => {
    const records = trace([[300, 190], [60, 140]]);
    expect(continuousRaceEffort([...records, ...records], profile)).toBeNull();
    records[100].elapsedSeconds = Number.NaN;
    expect(continuousRaceEffort(records, profile)).toBeNull();
  });
});
