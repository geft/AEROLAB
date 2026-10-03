import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { inferWorkoutPrescription, type WorkoutPrescription } from '../../shared/prescription.js';
import { ActivityRecord } from './csv-parser';
import type { AnalysisLap } from './fit-analysis.js';
import { MAX_OBSERVED_GAP_SECONDS, observedIntervals, timeDistribution, timeWeightedMean } from '../physiology/time-series.js';

const time = (r: ActivityRecord) => r.elapsedSeconds;
const mean = (records: ActivityRecord[], value: (r: ActivityRecord) => number | null, floor = 0) =>
  timeWeightedMean(records, time, value, v => v > floor) ?? 0;

// The prescription hint is computed by the shared helper so the run-detail table
// and the coach summary text can never disagree. Re-exported for existing callers.
export { inferWorkoutPrescription };
export type { WorkoutPrescription };

/**
 * Minimum ground a stride must cover. The floor exists to reject sensor spikes
 * that cover no distance, so it has to stay below what coarse GPS reports for a
 * genuine surge (a real 4:00-recovery stride measured 28m), otherwise the stride
 * is later dropped as a transient work block and its samples are absorbed into
 * the surrounding recoveries.
 */
const STRIDE_MIN_DISTANCE_M = 25;
const STRIDE_MIN_DURATION_SECONDS = 8;

/** A stride is followed promptly by sustained walking/rest, rather than a jog.
 * HR may peak in this recovery, so it must not define the burst's end or require
 * an immediate HR drop. Confirm elapsed time, not a count of sparse samples.
 */
function hasStrideRecovery(records: ActivityRecord[], endIndex: number): boolean {
  const burstEnd = records[endIndex].elapsedSeconds;
  let slowStart: number | null = null;
  let slowSeconds = 0;
  for (let index = endIndex + 1; index < records.length - 1; index++) {
    const record = records[index];
    if (record.elapsedSeconds > burstEnd + 30) break;
    const seconds = records[index + 1].elapsedSeconds - record.elapsedSeconds;
    const speed = record.speedMps;
    const cadence = record.cadence;
    const validSpeed = speed != null && Number.isFinite(speed) && speed >= 0;
    const validCadence = cadence != null && Number.isFinite(cadence) && cadence >= 0;
    const walking = validSpeed
      ? speed <= 1.8 && (!validCadence || cadence < 128)
      : validCadence && cadence > 0 && cadence < 128;
    if (!walking || seconds <= 0 || seconds > MAX_OBSERVED_GAP_SECONDS) {
      slowStart = null;
      slowSeconds = 0;
      continue;
    }
    slowStart ??= record.elapsedSeconds;
    if (slowStart - burstEnd > 12) return false;
    slowSeconds += Math.min(seconds, burstEnd + 30 - record.elapsedSeconds);
    if (slowSeconds >= 15) return true;
  }
  return false;
}

export interface DetectedInterval {
  intervalIndex: number;
  type: 'work' | 'recovery' | 'stride';
  startSeconds: number;
  durationSeconds: number;
  distanceMeters: number;
  avgSpeedMps: number;
  avgPaceSecKm: number;
  avgHeartRate: number;
  maxHeartRate: number;
  avgCadence: number;
  peakCadence?: number;
  peakSpeedMps?: number;
  peakPaceSecKm?: number;
  minStanceTime?: number;
  avgStanceTime?: number;
  avgVertOsc?: number;
  avgStepLength?: number;
  avgStrideLength?: number;
  avgVertRatio?: number;
  hrDrop?: number; // drop in heart rate during recovery
}

export interface DetectIntervalsOptions {
  laps?: AnalysisLap[];
  isRace?: boolean;
  lt1Hr?: number;
  lt2Hr?: number;
  stridePaceAnchorSecKm?: number;
  maxHr?: number;
  restingHr?: number;
}

/**
 * Detects workout intervals (reps, recoveries, strides) using physiological and biomechanical telemetry:
 * - Cadence & ground contact time (stance time) for kinematic running vs walking/resting
 * - Heart rate relative to athlete maximum / session distribution
 * - Strides require sustained speed contrast and prompt walking recovery.
 */
export function detectIntervals(
  records: ActivityRecord[],
  options: DetectIntervalsOptions = {}
): DetectedInterval[] {
  if (!records || records.length < 2) return [];
  // Missing time, reversals and long gaps separate workouts rather than creating
  // sustained evidence through unobserved portions of a recording.
  const traces: ActivityRecord[][] = [];
  let trace: ActivityRecord[] = [];
  for (const record of records) {
    if (record.timerActive === false || !Number.isFinite(record.elapsedSeconds)) {
      if (trace.length) traces.push(trace);
      trace = [];
      continue;
    }
    const previous = trace.at(-1);
    if (previous && (record.timerSegment !== previous.timerSegment || record.elapsedSeconds <= previous.elapsedSeconds || record.elapsedSeconds - previous.elapsedSeconds > MAX_OBSERVED_GAP_SECONDS)) {
      traces.push(trace);
      trace = [];
    }
    trace.push(record);
  }
  if (trace.length) traces.push(trace);
  if (traces.length !== 1 || traces[0].length !== records.length) {
    return traces.flatMap(part => detectIntervals(part, options)).map((interval, index) => ({ ...interval, intervalIndex: index + 1 }));
  }
  if (observedIntervals(records, time).reduce((sum, i) => sum + i.seconds, 0) < 59) return [];

  // Continuous time trials and races consist of 1 dominant benchmark work effort.
  // We identify the primary sustained running segment by cadence onset through to finish line deceleration.
  if (options.isRace) {
    return detectRaceInterval(records, options);
  }

  const lapIntervals = detectLapIntervals(records, options);
  if (lapIntervals) return lapIntervals;

  const cadences = timeDistribution(records, time, r => r.cadence, v => v > 0);
  const hrs = timeDistribution(records, time, r => r.heartRate, v => v > 0);
  const movingSpeeds = timeDistribution(records, time, r => r.speedMps, v => v > 0.5);
  if (cadences.seconds < 30) return [];
  const p90Cad = cadences.quantile(0.90), p50Cad = cadences.quantile(0.50), p20Cad = cadences.quantile(0.20);
  const p85Spd = movingSpeeds.quantile(0.85), p50Spd = movingSpeeds.quantile(0.50), p20Spd = movingSpeeds.quantile(0.20);

  const baseSpeed = p50Spd > 0.5 ? p50Spd : 2.5;
  const baseCad = p50Cad > 100 ? p50Cad : 160;

  // Strides must exceed both a run-relative surge threshold and the runner's
  // date-specific LT2 pace when that calibrated pace is available.
  const stridePaceAnchorSpeed = options.stridePaceAnchorSecKm && options.stridePaceAnchorSecKm > 0
    ? 1000 / options.stridePaceAnchorSecKm
    : 0;
  const strideSpeedThreshold = Math.max(baseSpeed * 1.20, baseSpeed + 0.35, stridePaceAnchorSpeed);
  const strideCadThreshold = Math.max(162, baseCad + 8);

  const sessionMaxHr = hrs.quantile(1);
  const p80Hr = hrs.quantile(0.80);
  const p20Hr = hrs.quantile(0.20);

  const { lt1Hr: athleteLt1, lt2Hr: athleteLt2 } = resolveHeartRateProfile(options);

  // Running cadence vs walking/rest (running jog >= 128 spm, walking recovery < 128 spm)
  const isRunningCadence = (c: number) => c >= 128;
  const avgRunningHr = mean(records, r => isRunningCadence(r.cadence ?? 0) ? r.heartRate : null);

  // Speed contrast between work and recovery
  const hasSpeedContrast = movingSpeeds.seconds > 30 && (
    p85Spd - p50Spd >= 0.5 ||
    p85Spd - p20Spd >= 0.6 ||
    (p50Spd > 0 && (p85Spd - p50Spd) / p50Spd >= 0.18)
  );
  // Threshold sits between recovery pace and work pace
  const workSpeedThreshold = (p85Spd + p20Spd) / 2;

  // Cadence contrast between work and recovery (relative to athlete's cadence distribution)
  const hasCadenceContrast = (p90Cad - p20Cad >= 18) || (p90Cad - p50Cad >= 12);
  const workCadenceThreshold = (p90Cad + Math.max(p20Cad, 100)) / 2;

  const hasHrContrast = sessionMaxHr > 120 && (sessionMaxHr - p20Hr >= 18 || p80Hr - p20Hr >= 14);
  const hrWorkThreshold = hasHrContrast
    ? Math.max(athleteLt1, (p80Hr + p20Hr) / 2)
    : (athleteLt2 - 5);

  // Check if this run is an easy base run (running HR below LT1 ceiling, no prolonged rest walks)
  const walkingSeconds = timeDistribution(records, time, r => r.cadence, v => v >= 0 && v < 125).seconds;
  const lt1Ceiling = athleteLt1;
  const isEasyBaseSession = avgRunningHr <= lt1Ceiling + 2 && walkingSeconds < 60;

  // Label each second as active effort or recovery
  const states: ('work' | 'recovery')[] = records.map(r => {
    const cad = r.cadence ?? 0;
    const spd = r.speedMps ?? 0;
    const hr = r.heartRate ?? 0;

    // 1. High velocity / fast turnover burst (stride candidate, handles optical sensor latency at start)
    if (spd >= strideSpeedThreshold || cad >= strideCadThreshold || (cad >= baseCad + 10 && spd >= baseSpeed * 1.15)) {
      return 'work';
    }

    // If easy base session with no interval structure, non-burst running is recovery/base
    if (isEasyBaseSession && !hasSpeedContrast) {
      return 'recovery';
    }

    // 2. Structured work rep: speed contrast (standard outdoor intervals)
    if (hasSpeedContrast && spd >= workSpeedThreshold && (cad >= 115 || spd >= workSpeedThreshold)) {
      return 'work';
    }

    // 3. Cadence contrast with elevated HR or speed (e.g. slow pace threshold or treadmill)
    if (hasCadenceContrast && cad >= workCadenceThreshold && (hr >= hrWorkThreshold || spd >= workSpeedThreshold)) {
      return 'work';
    }

    // 4. Physiological HR contrast (indoor hills / treadmill with flat GPS)
    // HR can remain elevated through a jogging recovery. Where recorded speed
    // separates work and recovery, residual HR must not erase that structure.
    if (hasHrContrast && hr >= hrWorkThreshold && isRunningCadence(cad) &&
        (!hasSpeedContrast || spd >= workSpeedThreshold) &&
        (!hasCadenceContrast || cad >= workCadenceThreshold)) {
      return 'work';
    }

    return 'recovery';
  });

  // Group raw blocks
  interface RawBlock {
    type: 'work' | 'recovery' | 'stride';
    startIndex: number;
    endIndex: number;
  }
  const rawBlocks: RawBlock[] = [];
  let currentType: 'work' | 'recovery' | 'stride' = states[0];
  let startIndex = 0;
  for (let i = 1; i < states.length; i++) {
    if (states[i] !== currentType) {
      rawBlocks.push({ type: currentType, startIndex, endIndex: i - 1 });
      currentType = states[i];
      startIndex = i;
    }
  }
  rawBlocks.push({ type: currentType, startIndex, endIndex: states.length - 1 });

  // Promote short explosive bursts to strides, demote warmup noise and stoplight flutters
  for (const b of rawBlocks) {
    if (b.type === 'work') {
      const durSec = (records[b.endIndex]?.elapsedSeconds ?? 0) - (records[b.startIndex]?.elapsedSeconds ?? 0);
      const blockRecs = records.slice(b.startIndex, b.endIndex + 1);
      const maxSpd = Math.max(...blockRecs.map(r => r?.speedMps ?? 0));
      const fast = timeDistribution(blockRecs, time, r => r.speedMps, v => v >= strideSpeedThreshold);
      const avgFastSpeed = mean(blockRecs, r => r.speedMps, strideSpeedThreshold - Number.EPSILON);
      const fastShare = durSec > 0 ? fast.seconds / durSec : 0;
      const _minStance = Math.min(...blockRecs.map(r => (r?.stanceTime && r.stanceTime > 100) ? r.stanceTime : 9999));
      // Promote a provisional burst from sustained fast samples, without
      // letting acceleration/deceleration dilute its calibrated pace. Validate
      // duration and ground covered after expanding the complete stride below.
      const clearsPaceAnchor = stridePaceAnchorSpeed === 0 || avgFastSpeed > stridePaceAnchorSpeed;
      if (durSec <= 45 && maxSpd >= strideSpeedThreshold && fastShare >= 0.6 && clearsPaceAnchor) {
        b.type = 'stride';
      } else if (isEasyBaseSession && !hasSpeedContrast && !hasCadenceContrast && durSec < 90) {
        b.type = 'recovery';
      }
    }
  }

  // Entry backfill for work blocks
  for (let i = 0; i < rawBlocks.length; i++) {
    if (rawBlocks[i].type === 'work' && i > 0 && rawBlocks[i - 1].type === 'recovery') {
      const prevRec = rawBlocks[i - 1];
      const repCad = records[rawBlocks[i].startIndex]?.cadence ?? 0;
      let backfilledStart = rawBlocks[i].startIndex;
      while (
        backfilledStart > prevRec.startIndex &&
        (records[rawBlocks[i].startIndex].elapsedSeconds - records[backfilledStart - 1].elapsedSeconds) <= 90 &&
        (records[backfilledStart - 1]?.cadence ?? 0) >= repCad - 6
      ) {
        backfilledStart--;
      }
      if (backfilledStart < rawBlocks[i].startIndex) {
        prevRec.endIndex = backfilledStart - 1;
        rawBlocks[i].startIndex = backfilledStart;
      }
    }
  }

  // Boundary expansion for strides:
  // When bursting into a stride from a dead stop or walk, wrist optical sensors often
  // register cadence as 0 for 3-8s (sensor latency/dropout) even while speed surges to 5+ m/s,
  // and arm swing drops to 0 during deceleration. We bridge these sensor dropouts by checking
  // if adjacent records have cadence dropout (cadence == 0 or < 130) while moving at sprint velocity.
  for (let i = 0; i < rawBlocks.length; i++) {
    if (rawBlocks[i].type === 'stride') {
      const blockRecs = records.slice(rawBlocks[i].startIndex, rawBlocks[i].endIndex + 1);
      const stridePeakSpeed = Math.max(...blockRecs.map(r => r.speedMps ?? 0));

      if (stridePeakSpeed > 0) {
        // Backward expansion (acceleration phase with cadence latency)
        if (i > 0 && rawBlocks[i - 1].type === 'recovery') {
          const prevRec = rawBlocks[i - 1];
          let backfilledStart = rawBlocks[i].startIndex;
          while (
            backfilledStart > prevRec.startIndex &&
            records[rawBlocks[i].startIndex].elapsedSeconds - records[backfilledStart - 1].elapsedSeconds <= 12
          ) {
            const r = records[backfilledStart - 1];
            if (!r) break;
            const cad = r.cadence ?? 0;
            const spd = r.speedMps ?? 0;
            const isSensorLagSprint = (cad === 0 || cad < 130) && spd >= stridePeakSpeed * 0.65;
            if (isSensorLagSprint) {
              backfilledStart--;
            } else {
              break;
            }
          }
          if (backfilledStart < rawBlocks[i].startIndex) {
            prevRec.endIndex = backfilledStart - 1;
            rawBlocks[i].startIndex = backfilledStart;
          }
        }

        // Forward expansion (deceleration phase with cadence dropout)
        if (i < rawBlocks.length - 1 && rawBlocks[i + 1].type === 'recovery') {
          const nextRec = rawBlocks[i + 1];
          let forwardEnd = rawBlocks[i].endIndex;
          while (
            forwardEnd < nextRec.endIndex &&
            records[forwardEnd + 1].elapsedSeconds - records[rawBlocks[i].endIndex].elapsedSeconds <= 8
          ) {
            const r = records[forwardEnd + 1];
            if (!r) break;
            const cad = r.cadence ?? 0;
            const spd = r.speedMps ?? 0;
            const isDecelDropout = (cad === 0 || cad < 130) && spd >= stridePeakSpeed * 0.60;
            if (isDecelDropout) {
              forwardEnd++;
            } else {
              break;
            }
          }
          if (forwardEnd > rawBlocks[i].endIndex) {
            nextRec.startIndex = forwardEnd + 1;
            rawBlocks[i].endIndex = forwardEnd;
          }
        }
      }
    }
  }

  // Filter out any blocks fully consumed by expansions and ensure bounds
  // A brief acceleration followed by continued running is a surge. Delayed HR
  // rise can persist into genuine walking recovery and must not veto a stride.
  for (const block of rawBlocks) {
    if (block.type === 'stride' && !hasStrideRecovery(records, block.endIndex)) block.type = 'work';
  }
  const validRawBlocks = rawBlocks.filter(
    b => b.startIndex <= b.endIndex && b.startIndex >= 0 && b.endIndex < records.length
  );

  // Merge spurious dips inside long reps
  const mergedDips: RawBlock[] = [];
  for (let i = 0; i < validRawBlocks.length; i++) {
    const b = validRawBlocks[i];
    const prev = mergedDips[mergedDips.length - 1];
    const next = validRawBlocks[i + 1];

    const dur = (records[b.endIndex]?.elapsedSeconds ?? 0) - (records[b.startIndex]?.elapsedSeconds ?? 0);
    const prevDur = prev ? (records[prev.endIndex]?.elapsedSeconds ?? 0) - (records[prev.startIndex]?.elapsedSeconds ?? 0) : 0;
    const nextDur = next ? (records[next.endIndex]?.elapsedSeconds ?? 0) - (records[next.startIndex]?.elapsedSeconds ?? 0) : 0;

    const blockRecs = records.slice(b.startIndex, b.endIndex + 1);
    const startHr = blockRecs[0]?.heartRate ?? 0;
    const minHr = Math.min(...blockRecs.map(r => r.heartRate || 999).filter(h => h < 999));
    const hrDrop = startHr > 0 && minHr < 999 ? startHr - minHr : 0;

    const isSpuriousDip = b.type === 'recovery' &&
      prev && prev.type === 'work' &&
      next && next.type === 'work' &&
      dur <= 60 &&
      prevDur >= 150 &&
      (nextDur >= 150 || (dur <= 20 && nextDur >= 60 &&
        blockRecs.every(r => (r.cadence ?? 0) >= 128))) &&
      hrDrop < 15;

    const isStrideDip = b.type === 'recovery' &&
      prev && prev.type === 'stride' &&
      next && next.type === 'stride' &&
      dur <= 4;

    if (isSpuriousDip || isStrideDip) {
      prev.endIndex = b.endIndex;
    } else if (prev && prev.type === b.type) {
      prev.endIndex = b.endIndex;
    } else {
      mergedDips.push({ ...b });
    }
  }

  // Filter transient blocks
  const validBlocks = mergedDips.filter(b => {
    if (b.startIndex > b.endIndex || b.startIndex < 0 || b.endIndex >= records.length) return false;
    const dur = (records[b.endIndex]?.elapsedSeconds ?? 0) - (records[b.startIndex]?.elapsedSeconds ?? 0);
    if (b.type === 'stride') {
      const startDist = records[b.startIndex]?.distanceMeters ?? 0;
      const endDist = records[b.endIndex]?.distanceMeters ?? startDist;
      const dist = Math.max(0, endDist - startDist);
      // Reject provisional bursts without enough duration or actual movement.
      return dur >= STRIDE_MIN_DURATION_SECONDS && dur <= 45 && dist >= STRIDE_MIN_DISTANCE_M;
    }
    if (b.type === 'work') return dur >= 15;
    return dur >= 8;
  });

  const activeWorkOrStride = validBlocks.filter(b => b.type === 'work' || b.type === 'stride');
  if (activeWorkOrStride.length === 0) return [];
  if (activeWorkOrStride.length === 1 && activeWorkOrStride[0].type === 'work') {
    const recs = validBlocks.filter(b => b.type === 'recovery');
    if (recs.length === 0) return [];
  }

  // Demote warmup/cooldown junk if quality reps exist
  const workBlocks = validBlocks.filter(b => b.type === 'work');
  if (workBlocks.length > 0) {
    const maxRepHr = Math.max(
      ...workBlocks.map(b => {
        const recs = records.slice(b.startIndex, b.endIndex + 1);
        return Math.max(...recs.map(r => r.heartRate ?? 0));
      })
    );

    // A short, much slower segment outside a sustained set is warm-up/cool-down,
    // even if cadence and residual HR remain high. Preserve fast finishing reps.
    const sustainedCandidates = workBlocks.filter(b => records[b.endIndex].elapsedSeconds - records[b.startIndex].elapsedSeconds >= 180);
    const sustainedSpeeds = sustainedCandidates.map(b => {
      const recs = records.slice(b.startIndex, b.endIndex + 1);
      return mean(recs, r => r.speedMps);
    }).sort((a, b) => a - b);
    // Establish the quality set from the fast sustained cluster first. A long
    // cooldown can itself be a work-shaped block when cadence stays elevated;
    // including it in the reference would make the cooldown redefine the set.
    const fastestSustainedSpeed = sustainedSpeeds[sustainedSpeeds.length - 1] ?? 0;
    const sustained = sustainedCandidates.filter(b => {
      const recs = records.slice(b.startIndex, b.endIndex + 1);
      const avgSpeed = mean(recs, r => r.speedMps);
      return fastestSustainedSpeed <= 0 || avgSpeed >= fastestSustainedSpeed * 0.85;
    });
    const referenceSpeed = sustained.length > 0
      ? sustained.reduce((sum, b) => {
          const recs = records.slice(b.startIndex, b.endIndex + 1);
          return sum + mean(recs, r => r.speedMps);
        }, 0) / sustained.length
      : 0;
    const firstWork = sustained[0]?.startIndex;
    const lastWork = sustained[sustained.length - 1]?.endIndex;

    const pruned: RawBlock[] = [];
    for (const b of validBlocks) {
      if (b.type === 'work') {
        const blockRecs = records.slice(b.startIndex, b.endIndex + 1);
        const avgHr = mean(blockRecs, r => r.heartRate);
        const avgSpeed = mean(blockRecs, r => r.speedMps);
        const outsideSet = sustained.length >= 2 && (b.endIndex < firstWork || b.startIndex > lastWork);
        if (outsideSet && referenceSpeed > 0 && avgSpeed < referenceSpeed * 0.85 && avgHr < athleteLt2 - 5) {
          pruned.push({ ...b, type: 'recovery' });
          continue;
        }
        const pruneCeiling = athleteLt1 + 2;
        if (maxRepHr > 130 && avgHr < pruneCeiling) {
          pruned.push({ type: 'recovery', startIndex: b.startIndex, endIndex: b.endIndex });
          continue;
        }
      }
      pruned.push({ ...b });
    }
    return buildFinalIntervals(records, pruned);
  }

  return buildFinalIntervals(records, validBlocks);
}

function detectRaceInterval(records: ActivityRecord[], options: DetectIntervalsOptions): DetectedInterval[] {
  interface Seg {
    start: number;
    end: number;
    dur: number;
    avgHr: number;
    avgCad: number;
  }
  const segs: Seg[] = [];
  let inRun = false;
  let start = 0;

  for (let i = 0; i < records.length; i++) {
    const cad = records[i].cadence ?? 0;
    const isRunning = cad >= 128;

    if (isRunning && !inRun) {
      inRun = true;
      start = i;
    } else if (!isRunning && inRun) {
      let restSeconds = 0;
      const windowEnd = records[i].elapsedSeconds + 20;
      for (let j = i; j < records.length - 1 && records[j].elapsedSeconds < windowEnd; j++) {
        const sampleSeconds = records[j + 1].elapsedSeconds - records[j].elapsedSeconds;
        if ((records[j].cadence ?? 0) < 128 && sampleSeconds > 0 && sampleSeconds <= MAX_OBSERVED_GAP_SECONDS) {
          restSeconds += Math.min(sampleSeconds, windowEnd - records[j].elapsedSeconds);
        }
      }
      if (restSeconds >= 15 || i === records.length - 1) {
        inRun = false;
        const dur = records[i - 1].elapsedSeconds - records[start].elapsedSeconds;
        const sub = records.slice(start, i);
        const avgHr = mean(sub, r => r.heartRate);
        const avgCad = mean(sub, r => r.cadence);
        if (dur >= 60) segs.push({ start, end: i - 1, dur, avgHr, avgCad });
      }
    }
  }
  if (inRun) {
    const dur = records[records.length - 1].elapsedSeconds - records[start].elapsedSeconds;
    const sub = records.slice(start);
    const avgHr = mean(sub, r => r.heartRate);
    const avgCad = mean(sub, r => r.cadence);
    if (dur >= 60) segs.push({ start, end: records.length - 1, dur, avgHr, avgCad });
  }

  if (segs.length === 0) return [];

  segs.sort((a, b) => (b.avgHr * Math.log(b.dur)) - (a.avgHr * Math.log(a.dur)));
  const best = segs[0];

  const blocks: { type: 'work' | 'recovery' | 'stride'; startIndex: number; endIndex: number }[] = [];
  // Evaluate preparation and cooldown against their own easy-running baseline.
  // The much faster benchmark must not raise the stride threshold for these
  // segments, and its finishing acceleration must remain part of the race.
  const appendOutsideRace = (startIndex: number, endIndex: number) => {
    if (startIndex > endIndex) return;
    const outside = records.slice(startIndex, endIndex + 1);
    const strides = detectIntervals(outside, { ...options, isRace: false })
      .filter(interval => interval.type === 'stride');
    let start = startIndex;
    let type: 'recovery' | 'stride' = 'recovery';
    for (let index = startIndex; index <= endIndex; index++) {
      const elapsed = records[index].elapsedSeconds;
      const nextType = strides.some(stride => elapsed >= stride.startSeconds - 0.05 &&
        elapsed <= stride.startSeconds + stride.durationSeconds + 0.1) ? 'stride' : 'recovery';
      if (nextType !== type) {
        if (start < index) blocks.push({ type, startIndex: start, endIndex: index - 1 });
        start = index;
        type = nextType;
      }
    }
    blocks.push({ type, startIndex: start, endIndex });
  };
  appendOutsideRace(0, best.start - 1);
  blocks.push({ type: 'work', startIndex: best.start, endIndex: best.end });
  appendOutsideRace(best.end + 1, records.length - 1);

  return buildFinalIntervals(records, blocks);
}

/** Intensity labels describe structure, never physiological workout type.
 * Require measured quality effort and explicit recovery/warmup/cooldown.
 * Distance autolaps containing only active labels cannot create repetitions.
 */
function detectLapIntervals(records: ActivityRecord[], options: DetectIntervalsOptions): DetectedInterval[] | null {
  if (!options.laps?.length) return null;
  const { lt2Hr } = resolveHeartRateProfile(options);
  const first = records[0].elapsedSeconds, last = records.at(-1)!.elapsedSeconds;
  const candidates = options.laps.filter(lap => lap.end > first && lap.start < last)
    .map(lap => ({ ...lap, start: Math.max(first, lap.start), end: Math.min(last, lap.end) })).map(lap => {
    const startIndex = records.findIndex(record => record.elapsedSeconds >= lap.start);
    let endIndex = records.findIndex(record => record.elapsedSeconds >= lap.end);
    if (endIndex < 0) endIndex = records.length - 1;
    const samples = records.slice(startIndex, endIndex + 1);
    const duration = observedIntervals(samples, time).reduce((sum, interval) => sum + interval.seconds, 0);
    const effort = lap.intensity === 'active' && duration >= 30 && mean(samples, r => r.cadence) >= 128;
    const work = effort && mean(samples, r => r.heartRate) >= lt2Hr - 5;
    return { lap, startIndex, endIndex, work, effort, duration };
  });
  const works = candidates.filter(candidate => candidate.work);
  const explicitRecovery = (intensity: string) => ['rest', 'recovery'].includes(intensity);
  const repeated = works.some((work, index) => index > 0 && candidates.some(candidate =>
    candidate.lap.start >= works[index - 1].lap.end - 0.5 && candidate.lap.end <= work.lap.start + 0.5 &&
    explicitRecovery(candidate.lap.intensity) && candidate.duration >= 30));
  const sustained = works.length === 1 && works[0].duration >= 450 && candidates.some(candidate =>
    ['warmup', 'cooldown'].includes(candidate.lap.intensity) && candidate.duration >= 30);
  if (!repeated && !sustained) return null;
  // Missing lap coverage falls back to telemetry rather than hiding unlabelled work.
  if (!candidates.length || candidates[0].lap.start > first + 1 || candidates.at(-1)!.lap.end < last - 1 ||
      candidates.some((candidate, index) => index > 0 && candidate.lap.start - candidates[index - 1].lap.end > 1)) return null;
  // Once measured quality work validates the structure, keep lower-HR active
  // reps too: missed stimulus/late fade must not disappear as recovery.
  const strides = detectIntervals(records, { ...options, laps: undefined }).filter(interval => interval.type === 'stride');
  const blocks: { type: 'work' | 'recovery' | 'stride'; startIndex: number; endIndex: number }[] = [];
  for (const candidate of candidates) {
    if (candidate.effort) {
      blocks.push({ type: 'work', startIndex: candidate.startIndex, endIndex: candidate.endIndex });
      continue;
    }
    let startIndex = candidate.startIndex;
    for (const stride of strides.filter(stride => stride.startSeconds >= candidate.lap.start &&
      stride.startSeconds + stride.durationSeconds <= candidate.lap.end)) {
      const strideStart = records.findIndex(record => record.elapsedSeconds >= stride.startSeconds);
      const strideEnd = records.findIndex(record => record.elapsedSeconds >= stride.startSeconds + stride.durationSeconds);
      if (strideStart > startIndex) blocks.push({ type: 'recovery', startIndex, endIndex: strideStart });
      blocks.push({ type: 'stride', startIndex: strideStart, endIndex: strideEnd });
      startIndex = strideEnd;
    }
    if (startIndex < candidate.endIndex) blocks.push({ type: 'recovery', startIndex, endIndex: candidate.endIndex });
  }
  return buildFinalIntervals(records, blocks);
}

function buildFinalIntervals(
  records: ActivityRecord[],
  blocks: { type: 'work' | 'recovery' | 'stride'; startIndex: number; endIndex: number }[]
): DetectedInterval[] {
  // Consolidate adjacent of same type
  const consolidated: { type: 'work' | 'recovery' | 'stride'; startIndex: number; endIndex: number }[] = [];
  for (const b of blocks) {
    const last = consolidated[consolidated.length - 1];
    if (last && last.type === b.type) {
      last.endIndex = b.endIndex;
    } else {
      consolidated.push({ ...b });
    }
  }

  const intervals: DetectedInterval[] = [];
  let intervalIndex = 1;

  for (const block of consolidated) {
    const recs = records.slice(block.startIndex, block.endIndex + 1);
    if (recs.length === 0) continue;

    const startSec = recs[0].elapsedSeconds;
    const endSec = recs[recs.length - 1].elapsedSeconds;
    const durSec = Math.max(1, endSec - startSec);

    const startDist = recs[0].distanceMeters ?? 0;
    const endDist = recs[recs.length - 1].distanceMeters ?? startDist;
    const distM = Math.max(0, endDist - startDist);

    let maxHr = 0;
    let maxCad = 0;
    let maxSpeed = 0;
    let minStance = 9999;

    for (const r of recs) {
      if (r.heartRate) {
        if (r.heartRate > maxHr) maxHr = r.heartRate;
      }
      if (r.cadence) {
        if (r.cadence > maxCad) maxCad = r.cadence;
      }
      if (r.speedMps) {
        if (r.speedMps > maxSpeed) maxSpeed = r.speedMps;
      }
      if (r.stanceTime && r.stanceTime > 100) {
        if (r.stanceTime < minStance) minStance = r.stanceTime;
      }
    }

    const avgHr = Math.round(mean(recs, r => r.heartRate));
    const avgCad = Math.round(mean(recs, r => r.cadence));
    const avgSpeed = timeWeightedMean(recs, time, r => r.speedMps) ?? distM / durSec;
    const avgPace = avgSpeed > 0 ? Math.round(1000 / avgSpeed) : 0;
    const peakPace = maxSpeed > 0 ? Math.round(1000 / maxSpeed) : avgPace;
    const stance = timeWeightedMean(recs, time, r => r.stanceTime, v => v > 100);
    const vo = timeWeightedMean(recs, time, r => r.verticalOscillation);
    const avgStance = stance != null ? Number(stance.toFixed(1)) : undefined;
    const avgVo = vo != null ? Number(vo.toFixed(1)) : undefined;

    let avgStepLength: number | undefined;
    let avgStrideLength: number | undefined;
    let avgVertRatio: number | undefined;

    if (avgCad > 0 && durSec > 0 && distM > 0) {
      const totalSteps = avgCad * (durSec / 60);
      avgStepLength = Number((distM / totalSteps).toFixed(2));
      avgStrideLength = Number((avgStepLength * 2).toFixed(2));

      if (avgVo && avgStepLength > 0) {
        const voInMm = avgVo < 25 ? avgVo * 10 : avgVo;
        avgVertRatio = Number((voInMm / (avgStepLength * 10)).toFixed(1));
      }
    }
    const measuredStep = timeWeightedMean(recs, time, r => r.stepLength, value => value > 0 && value < 3);
    const measuredRatio = timeWeightedMean(recs, time, r => r.verticalRatio, value => value > 0 && value < 30);
    if (measuredStep !== null) {
      avgStepLength = Number(measuredStep.toFixed(2));
      avgStrideLength = Number((measuredStep * 2).toFixed(2));
      if (avgVo && measuredRatio === null) {
        const voInMm = avgVo < 25 ? avgVo * 10 : avgVo;
        avgVertRatio = Number((voInMm / (measuredStep * 10)).toFixed(1));
      }
    }
    if (measuredRatio !== null) avgVertRatio = Number(measuredRatio.toFixed(1));

    let hrDrop: number | undefined;
    if (block.type === 'recovery' && durSec >= 3) {
      const initialHr = recs[0].heartRate ?? avgHr;
      const validHrs = recs.map(r => r.heartRate || 999).filter(h => h < 999);
      const minHrInBlock = validHrs.length > 0 ? Math.min(...validHrs) : initialHr;
      hrDrop = Math.max(0, initialHr - minHrInBlock);
    }

    intervals.push({
      intervalIndex: intervalIndex++,
      type: block.type,
      startSeconds: Number(startSec.toFixed(1)),
      durationSeconds: Number(durSec.toFixed(1)),
      distanceMeters: Number(distM.toFixed(1)),
      avgSpeedMps: Number(avgSpeed.toFixed(2)),
      avgPaceSecKm: avgPace,
      avgHeartRate: avgHr,
      maxHeartRate: maxHr > 0 ? maxHr : avgHr,
      avgCadence: avgCad,
      peakCadence: maxCad > 0 ? maxCad : undefined,
      peakSpeedMps: maxSpeed > 0 ? Number(maxSpeed.toFixed(2)) : undefined,
      peakPaceSecKm: peakPace > 0 ? peakPace : undefined,
      minStanceTime: minStance !== 9999 ? minStance : undefined,
      avgStanceTime: avgStance,
      avgVertOsc: avgVo,
      avgStepLength,
      avgStrideLength,
      avgVertRatio,
      hrDrop
    });
  }

  return intervals;
}
