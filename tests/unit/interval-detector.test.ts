import { describe, it, expect } from 'vitest';
import { detectIntervals, inferWorkoutPrescription } from '../../src/backend/ingestion/interval-detector';
import { ActivityRecord } from '../../src/backend/ingestion/csv-parser';

describe('Interval & Stride Detector (Unit)', () => {
  function makeRecord(sec: number, cad: number, spd: number, hr: number, stance = 240): ActivityRecord {
    return {
      timestamp: `2026-09-11T20:${Math.floor(sec / 60)}:${sec % 60}Z`,
      elapsedSeconds: sec,
      heartRate: hr,
      cadence: cad,
      speedMps: spd,
      distanceMeters: sec * spd,
      altitudeMeters: 10,
      latitude: null,
      longitude: null,
      temperature: 28,
      verticalOscillation: 7.0,
      stanceTime: stance
    };
  }

  it('returns empty array if records < 60', () => {
    const records = Array.from({ length: 30 }, (_, i) => makeRecord(i, 170, 3.5, 150));
    expect(detectIntervals(records)).toEqual([]);
  });

  it('returns empty array for a steady run with zero rest breaks (only 1 continuous work block)', () => {
    // 300 seconds of uninterrupted running
    const records = Array.from({ length: 300 }, (_, i) => makeRecord(i, 168, 3.2, 138));
    expect(detectIntervals(records)).toEqual([]);
  });

  it('detects structured intervals: work -> recovery -> work', () => {
    const records: ActivityRecord[] = [];
    let sec = 0;

    // Rep 1: 60s hard interval (175 spm, 4.0 m/s, HR 150->165)
    for (let i = 0; i < 60; i++, sec++) {
      records.push(makeRecord(sec, 175, 4.0, 150 + Math.floor(i * 0.25), 210));
    }
    // Rest 1: 40s recovery walk (90 spm, 1.0 m/s, HR 165->130)
    for (let i = 0; i < 40; i++, sec++) {
      records.push(makeRecord(sec, 90, 1.0, 165 - Math.floor(i * 0.8), 350));
    }
    // Rep 2: 60s hard interval (178 spm, 4.2 m/s, HR 140->170)
    for (let i = 0; i < 60; i++, sec++) {
      records.push(makeRecord(sec, 178, 4.2, 140 + Math.floor(i * 0.5), 205));
    }

    const intervals = detectIntervals(records);
    expect(intervals.length).toBeGreaterThanOrEqual(3);

    const workReps = intervals.filter(i => i.type === 'work');
    const recoveries = intervals.filter(i => i.type === 'recovery');

    expect(workReps.length).toBe(2);
    expect(recoveries.length).toBe(1);

    // HR drop during recovery
    expect(recoveries[0].hrDrop).toBeGreaterThan(15);
    // Work rep dynamics
    expect(workReps[0].avgCadence).toBeGreaterThan(170);
    expect(workReps[0].minStanceTime).toBeLessThanOrEqual(210);
  });

  it('classifies short high-velocity bursts (<=45s, speed >= 3.4 m/s) as strides', () => {    const records: ActivityRecord[] = [];
    let sec = 0;

    // Base jog: 60s
    for (let i = 0; i < 60; i++, sec++) {
      records.push(makeRecord(sec, 160, 2.8, 130));
    }
    // Rest: 20s
    for (let i = 0; i < 20; i++, sec++) {
      records.push(makeRecord(sec, 80, 0.8, 120));
    }
    // Stride 1: 25s explosive acceleration (195 spm, 5.2 m/s, min stance 185ms)
    for (let i = 0; i < 25; i++, sec++) {
      records.push(makeRecord(sec, 195, 5.2, 155, 185));
    }
    // Rest: 30s
    for (let i = 0; i < 30; i++, sec++) {
      records.push(makeRecord(sec, 80, 0.8, 130));
    }
    // Stride 2: 25s explosive acceleration (198 spm, 5.4 m/s, min stance 180ms)
    for (let i = 0; i < 25; i++, sec++) {
      records.push(makeRecord(sec, 198, 5.4, 160, 180));
    }

    const intervals = detectIntervals(records);
    const strides = intervals.filter(i => i.type === 'stride');

    expect(strides.length).toBe(2);
    expect(strides[0].peakCadence).toBeGreaterThanOrEqual(195);
    expect(strides[0].peakSpeedMps).toBeGreaterThanOrEqual(5.0);
    expect(strides[0].minStanceTime).toBeLessThanOrEqual(185);
  });

  it('bridges cadence sensor latency (cadence=0) at stride onset to capture full stride distance', () => {
    const records: ActivityRecord[] = [];
    let sec = 0;
    let cumDist = 0;
    const pushRec = (cad: number, spd: number, hr: number, stance = 240) => {
      cumDist += spd;
      records.push({
        timestamp: `2026-09-11T20:${Math.floor(sec / 60)}:${sec % 60}Z`,
        elapsedSeconds: sec++,
        heartRate: hr,
        cadence: cad,
        speedMps: spd,
        distanceMeters: cumDist,
        altitudeMeters: 10,
        latitude: null,
        longitude: null,
        temperature: 28,
        verticalOscillation: 7.0,
        stanceTime: stance
      });
    };

    // Walking before stride: 20s
    for (let i = 0; i < 20; i++) pushRec(110, 1.2, 125, 320);

    // Sudden sprint onset with optical sensor latency (4s of speed=5.5 m/s but cadence=0)
    for (let i = 0; i < 4; i++) pushRec(0, 5.5, 130, 170);

    // Stride sustained: 10s of cadence=205, speed=5.8 m/s
    for (let i = 0; i < 10; i++) pushRec(205, 5.8, 140, 160);

    // Deceleration arm drop: 2s of speed=4.8 m/s with cadence=0
    for (let i = 0; i < 2; i++) pushRec(0, 4.8, 140, 175);

    // Walking recovery: 40s
    for (let i = 0; i < 40; i++) pushRec(100, 1.1, 130, 330);

    const intervals = detectIntervals(records);
    const strides = intervals.filter(i => i.type === 'stride');

    expect(strides.length).toBe(1);
    // Should include the initial 4s latency and 2s decel (16s total instead of being clipped to 10s)
    expect(strides[0].durationSeconds).toBeGreaterThanOrEqual(14);
    // Distance should be ~80m+, not truncated to ~58m
    expect(strides[0].distanceMeters).toBeGreaterThan(70);
  });

  it('merges spurious sub-90s dips inside long threshold reps: 3x15m at slow pace', () => {
    // Regression for a 3x15m:3m session detected as 5 fragments (7:09 + 0:39 +
    // 6:44 style splits). Slow athlete pace (~7:35/km) must work identically.
    const records: ActivityRecord[] = [];
    let sec = 0;
    const push = (n: number, cad: number, spd: number, hr: number, stance = 220, vo = 68) => {
      for (let i = 0; i < n; i++, sec++) {
        records.push({
          timestamp: '2026-09-11T20:00:00Z',
          elapsedSeconds: sec,
          heartRate: hr,
          cadence: cad,
          speedMps: spd,
          distanceMeters: sec * spd,
          altitudeMeters: 10,
          latitude: null,
          longitude: null,
          temperature: 28,
          verticalOscillation: vo,
          stanceTime: stance
        });
      }
    };

    // Warmup jog
    for (let i = 0; i < 300; i++) push(1, 150, 2.0, 130 + Math.floor(i * 0.033));

    for (let rep = 0; rep < 3; rep++) {
      // 90s ramp 140 -> 168
      for (let i = 0; i < 90; i++) push(1, 162, 2.2, 140 + Math.floor(i * 0.31));
      // 310s plateau at 168 with a 39s spurious dip (traffic slowdown) at offset ~400
      for (let i = 0; i < 310; i++) push(1, 162, 2.2, 168);
      for (let i = 0; i < 39; i++) push(1, 120, 1.5, 162, 260, 72);
      for (let i = 0; i < 461; i++) push(1, 162, 2.2, 168);
      // 180s jog recovery 168 -> 140
      if (rep < 2) {
        for (let i = 0; i < 180; i++) push(1, 118, 1.6, 168 - Math.floor(i * 0.156));
      }
    }
    // Cooldown
    for (let i = 0; i < 180; i++) push(1, 140, 1.9, 140 - Math.floor(i * 0.044));

    const intervals = detectIntervals(records);
    const workReps = intervals.filter(i => i.type === 'work');

    expect(workReps.length).toBe(3);
    for (const w of workReps) {
      expect(Math.abs(w.durationSeconds - 900)).toBeLessThan(90);
    }

    const prescription = inferWorkoutPrescription(intervals);
    expect(prescription).not.toBeNull();
    expect(prescription!.repCount).toBe(3);
    expect(prescription!.workSeconds).toBe(900);
    expect(prescription!.recoverySeconds).toBe(180);
    expect(prescription!.label).toBe('3x15:00 / 3:00 rec');

    // Rich per-rep dynamics are populated (pace-free sensor telemetry)
    expect(workReps[0].avgVertOsc).toBeGreaterThan(0);
    expect(workReps[0].avgStanceTime).toBeGreaterThan(150);
    expect(workReps[0].avgStepLength).toBeGreaterThan(0.5);
    expect(workReps[0].avgStrideLength).toBeGreaterThan(1.0);
    // Derived stride ≈ 2.2 m/s * 60 / 162 spm * 2 ≈ 1.63 m
    expect(workReps[0].avgStrideLength!).toBeGreaterThan(1.2);
    expect(workReps[0].avgStrideLength!).toBeLessThan(2.2);
  });

  it('demotes warmup/cooldown junk around the quality set (R1/R2 post-pass)', () => {
    // Warmup HR wiggles and an easy cooldown jog must not count as work reps
    // even though they form sustained segments; the two real reps stay.
    const records: ActivityRecord[] = [];
    let sec = 0;
    const push = (n: number, cad: number, spd: number, hr: number) => {
      for (let i = 0; i < n; i++, sec++) {
        records.push({
          timestamp: '2026-09-11T20:00:00Z',
          elapsedSeconds: sec,
          heartRate: hr,
          cadence: cad,
          speedMps: spd,
          distanceMeters: sec * spd,
          altitudeMeters: 10,
          latitude: null,
          longitude: null,
          temperature: 28,
          verticalOscillation: 7.0,
          stanceTime: 230
        });
      }
    };

    // Warmup with wiggles that cross entry thresholds at low HR
    for (let i = 0; i < 600; i++) push(1, 165, 2.6, 128 + Math.floor(i * 0.02) + (i % 90 < 12 ? 8 : 0));
    // Rep 1: 300s @ ~172
    for (let i = 0; i < 60; i++) push(1, 182, 3.6, 150 + Math.floor(i * 0.36));
    for (let i = 0; i < 240; i++) push(1, 182, 3.6, 172);
    // Recovery 120s
    for (let i = 0; i < 120; i++) push(1, 120, 1.7, 172 - Math.floor(i * 0.25));
    // Rep 2: 300s @ ~172
    for (let i = 0; i < 60; i++) push(1, 182, 3.6, 150 + Math.floor(i * 0.36));
    for (let i = 0; i < 240; i++) push(1, 182, 3.6, 172);
    // Easy cooldown jog @ ~146 (below band, should not count)
    for (let i = 0; i < 300; i++) push(1, 168, 2.9, 146);

    const intervals = detectIntervals(records);
    const workReps = intervals.filter(i => i.type === 'work');
    expect(workReps.length).toBe(2);
    for (const w of workReps) {
      expect(w.avgHeartRate).toBeGreaterThan(150);
      expect(Math.abs(w.durationSeconds - 300)).toBeLessThan(60);
    }
  });

  it('isolates single dominant race work segment when isRace is true, demoting warm-up jogs and walk breaks', () => {
    const records: ActivityRecord[] = [];
    let t = 0;
    let dist = 0;
    const push = (dt: number, cad: number, spd: number, hr: number) => {
      t += dt;
      dist += dt * spd;
      records.push({
        timestamp: new Date(t * 1000).toISOString(),
        elapsedSeconds: t,
        distanceMeters: dist,
        cadence: cad,
        speedMps: spd,
        heartRate: hr,
        altitudeMeters: 10,
        latitude: null,
        longitude: null,
        temperature: 28,
        verticalOscillation: 8.0,
        stanceTime: 240
      });
    };

    // 1. Warm-up jog: 10 mins @ 147 bpm, then 5 min walk @ 123 bpm
    for (let i = 0; i < 600; i++) push(1, 172, 2.7, 147);
    for (let i = 0; i < 300; i++) push(1, 110, 1.5, 123);

    // 2. Main Race Segment: 20 mins @ 188 bpm (all-out 5K time trial)
    for (let i = 0; i < 1200; i++) push(1, 185, 3.8, 188);

    // 3. Cool-down walk: 8 mins @ 135 bpm
    for (let i = 0; i < 480; i++) push(1, 115, 1.6, 135);

    const intervals = detectIntervals(records, { isRace: true });
    const workReps = intervals.filter(i => i.type === 'work');

    // Exactly 1 work segment
    expect(workReps.length).toBe(1);
    expect(workReps[0].avgHeartRate).toBeGreaterThanOrEqual(180);
    expect(workReps[0].durationSeconds).toBeGreaterThanOrEqual(1150);
  });
});
