import { describe, expect, it } from 'vitest';
import { detectIntervals } from '../../src/backend/ingestion/interval-detector.js';
import { classifyRun } from '../../src/backend/ingestion/classifier.js';
import { calculateEconomy } from '../../src/backend/physiology/economy.js';
import { gradeRun } from '../../src/backend/physiology/coach-rubric.js';
import type { ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';

const profile = { lt1Hr: 144, lt2Hr: 178, maxHr: 203, restingHr: 54 };
function genericRun(step = 1): ActivityRecord[] {
  let distance = 0;
  return Array.from({ length: Math.floor(6000 / step) + 1 }, (_, i) => {
    const sec = i * step;
    const work = sec >= 1200 && sec < 4800;
    const cooldown = sec >= 4800;
    const speed = work ? 3.05 : cooldown ? 2.64 : 2.4;
    distance += speed * step;
    return { timestamp: new Date(Date.UTC(2026, 9, 3, 9, 47, sec)).toISOString(),
      elapsedSeconds: sec, heartRate: work ? 165 : cooldown ? 155 : 136,
      cadence: work ? 184 : cooldown ? 188 : 165, speedMps: speed, distanceMeters: distance,
      altitudeMeters: 10, latitude: null, longitude: null, temperature: 30,
      verticalOscillation: 80, stanceTime: 240 };
  });
}
function grade(records: ActivityRecord[], intervals = detectIntervals(records, profile)) {
  return gradeRun({ runType: 'tempo', isFailedWorkout: false, isAccidentalTempo: false,
    steadyHr: 159, steadyCadence: 184, steadyStanceTime: 240, decouplingPct: null,
    ...profile, maxHeartRate: profile.maxHr, activityMaxHr: 172, records, intervals });
}

describe('Sustained work without structured workout steps', () => {
  it.each([1, 6])('isolates one hour of work from high-cadence cooldown at %ss sampling', step => {
    const records = genericRun(step);
    const intervals = detectIntervals(records, profile);
    const work = intervals.filter(i => i.type === 'work');
    expect(work).toHaveLength(1);
    expect(work[0].startSeconds).toBeGreaterThanOrEqual(1200 - step);
    expect(work[0].startSeconds + work[0].durationSeconds).toBeLessThanOrEqual(4800 + step);
    expect(work[0].durationSeconds).toBeGreaterThan(3500);
    const classification = classifyRun({ id: 'generic', name: 'Running', sport: 'running',
      date: '2026-10-03 17:47:00', totalDistanceMeters: records.at(-1)!.distanceMeters!,
      totalDurationSeconds: 6000, totalElapsedSeconds: 6000, avgHeartRate: 156,
      maxHeartRate: 172, avgCadence: 180, maxCadence: 188, calories: 900,
      totalAscentMeters: 0, totalDescentMeters: 0 }, records, calculateEconomy(records), intervals, profile);
    expect(classification.runType).toBe('tempo');
    const result = grade(records, intervals);
    expect(result.verdict).toBe('on_track');
    expect(result.factors.some(f => ['interval_execution', 'rep_to_rep_fatigue', 'cardiovascular_stimulus'].includes(f.categoryId))).toBe(false);
    expect(result.factors.find(f => f.categoryId === 'sustained_intensity')?.points).toBe(50);
  });

  it('does not certify missing HR or missing work phases from whole-run averages', () => {
    expect(grade(genericRun().map(r => ({ ...r, heartRate: null }))).verdict).toBe('insufficient_evidence');
    expect(grade(genericRun().map(r => ({ ...r, heartRate: r.elapsedSeconds < 2400 ? r.heartRate : null }))).verdict).toBe('insufficient_evidence');
    expect(grade(genericRun(), []).verdict).toBe('insufficient_evidence');
  });

  it('retains slower late work when heart rate keeps rising rather than recovering', () => {
    const records = genericRun().map(r => r.elapsedSeconds >= 4800 ? { ...r, heartRate: 169 } : r);
    const work = detectIntervals(records, profile).filter(i => i.type === 'work');
    expect(work.at(-1)!.startSeconds + work.at(-1)!.durationSeconds).toBeGreaterThan(5900);
  });

  it('penalizes volatile pacing within the work without using cooldown pace', () => {
    const original = genericRun();
    const intervals = detectIntervals(original, profile);
    let distance = 0;
    const records = original.map(r => {
      const work = r.elapsedSeconds >= 1200 && r.elapsedSeconds < 4800;
      const speed = work ? Math.floor((r.elapsedSeconds - 1200) / 600) % 2 ? 2.2 : 3.9 : r.speedMps!;
      distance += speed;
      return { ...r, speedMps: speed, distanceMeters: distance };
    });
    expect(grade(records, intervals).verdict).toBe('off_target');
  });

  it('does not treat threshold intensity as successful upper-aerobic execution', () => {
    const records = genericRun();
    const intervals = detectIntervals(records, profile);
    const hard = records.map(r => r.elapsedSeconds >= 1200 && r.elapsedSeconds < 4800 ? { ...r, heartRate: 185 } : r);
    expect(grade(hard, intervals).verdict).toBe('off_target');
  });

  it('requires observed coverage rather than filling recording gaps', () => {
    const records = genericRun().filter(r => r.elapsedSeconds % 60 === 0);
    expect(grade(records, [{ type: 'work', startSeconds: 1200, durationSeconds: 3600,
      intervalIndex: 1, distanceMeters: 10000, avgSpeedMps: 3, avgPaceSecKm: 333,
      avgHeartRate: 165, maxHeartRate: 172, avgCadence: 184 }]).verdict).toBe('insufficient_evidence');
  });
});
