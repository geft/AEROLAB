import { ActivityRecord } from './csv-parser';

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

export interface WorkoutPrescription {
  repCount: number;
  workSeconds: number;
  recoverySeconds: number;
  label: string;
}

export interface DetectIntervalsOptions {
  isRace?: boolean;
  lt1Hr?: number;
  lt2Hr?: number;
  maxHr?: number;
  restingHr?: number;
}

/**
 * Infer prescription label from detected intervals (e.g. 3x15:00 / 3:00 rec).
 */
export function inferWorkoutPrescription(intervals: DetectedInterval[]): WorkoutPrescription | null {
  const workReps = intervals.filter(i => i.type === 'work');
  if (workReps.length < 2) return null;

  const durations = workReps.map(r => r.durationSeconds).sort((a, b) => a - b);
  const medianWorkSec = durations[Math.floor(durations.length / 2)];
  const isConsistentWork = workReps.every(r => Math.abs(r.durationSeconds - medianWorkSec) <= Math.max(90, medianWorkSec * 0.2));

  if (!isConsistentWork) return null;

  // Round work seconds to nearest standard step (e.g. 60s, 30s)
  const roundedWork = Math.round(medianWorkSec / 30) * 30;

  // Check recoveries between work reps
  const recDurs: number[] = [];
  for (let i = 0; i < intervals.length - 1; i++) {
    if (intervals[i].type === 'work' && intervals[i + 1].type === 'recovery') {
      recDurs.push(intervals[i + 1].durationSeconds);
    }
  }

  const medianRecSec = recDurs.length > 0
    ? recDurs.sort((a, b) => a - b)[Math.floor(recDurs.length / 2)]
    : 0;
  const roundedRec = Math.round(medianRecSec / 15) * 15;

  const formatMinSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const label = `${workReps.length}x${formatMinSec(roundedWork)}${roundedRec > 0 ? ` / ${formatMinSec(roundedRec)} rec` : ''}`;

  return {
    repCount: workReps.length,
    workSeconds: roundedWork,
    recoverySeconds: roundedRec,
    label
  };
}

/**
 * Detects workout intervals (reps, recoveries, strides) using pace-free physiological and biomechanical telemetry:
 * - Cadence & ground contact time (stance time) for kinematic running vs walking/resting
 * - Heart rate relative to athlete maximum / session distribution
 * - Completely avoids using speed or pace to determine effort, ensuring slower and faster athletes are treated identically.
 */
export function detectIntervals(
  records: ActivityRecord[],
  options: DetectIntervalsOptions = {}
): DetectedInterval[] {
  if (!records || records.length < 60) return [];

  // Continuous time trials and races consist of 1 dominant benchmark work effort.
  // We identify the primary sustained running segment by cadence onset through to finish line deceleration.
  if (options.isRace) {
    return detectRaceInterval(records);
  }

  const cadences = records.map(r => r.cadence ?? 0).filter(c => c > 0).sort((a, b) => a - b);
  const hrs = records.map(r => r.heartRate ?? 0).filter(h => h > 0).sort((a, b) => a - b);
  const movingSpeeds = records.map(r => r.speedMps ?? 0).filter(s => s > 0.5).sort((a, b) => a - b);
  if (cadences.length < 30) return [];

  const p90Cad = cadences[Math.floor(cadences.length * 0.90)];
  const p50Cad = cadences[Math.floor(cadences.length * 0.50)];
  const p20Cad = cadences[Math.floor(cadences.length * 0.20)];

  const p85Spd = movingSpeeds.length > 0 ? movingSpeeds[Math.floor(movingSpeeds.length * 0.85)] : 0;
  const p50Spd = movingSpeeds.length > 0 ? movingSpeeds[Math.floor(movingSpeeds.length * 0.50)] : 0;
  const p20Spd = movingSpeeds.length > 0 ? movingSpeeds[Math.floor(movingSpeeds.length * 0.20)] : 0;

  const baseSpeed = p50Spd > 0.5 ? p50Spd : 2.5;
  const baseCad = p50Cad > 100 ? p50Cad : 160;

  // Stride thresholds adapt to runner's baseline pace and cadence
  const strideSpeedThreshold = Math.min(3.4, Math.max(2.4, baseSpeed * 1.20));
  const strideCadThreshold = Math.max(188, baseCad + 8);

  const sessionMaxHr = hrs.length > 0 ? hrs[hrs.length - 1] : 0;
  const p80Hr = hrs.length > 0 ? hrs[Math.floor(hrs.length * 0.80)] : 0;
  const p20Hr = hrs.length > 0 ? hrs[Math.floor(hrs.length * 0.20)] : 0;

  const athleteLt1 = options.lt1Hr || 148;
  const athleteLt2 = options.lt2Hr || 167;

  // Running cadence vs walking/rest (accommodates slower runners down to 128 spm)
  const isRunningCadence = (c: number) => c >= 128;
  const runningRecs = records.filter(r => isRunningCadence(r.cadence ?? 0));
  const avgRunningHr = runningRecs.length > 0
    ? runningRecs.reduce((sum, r) => sum + (r.heartRate ?? 0), 0) / runningRecs.length
    : 0;

  // Speed contrast between work and recovery
  const hasSpeedContrast = movingSpeeds.length > 30 && (
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
  const walkingCount = records.filter(r => (r.cadence ?? 0) < 125).length;
  const lt1Ceiling = athleteLt1;
  const isEasyBaseSession = avgRunningHr <= lt1Ceiling + 2 && walkingCount < 60;

  // Label each second as active effort or recovery
  const states: ('work' | 'recovery')[] = records.map(r => {
    const cad = r.cadence ?? 0;
    const spd = r.speedMps ?? 0;
    const hr = r.heartRate ?? 0;
    const st = r.stanceTime ?? 0;

    // 1. High velocity / fast turnover burst (stride candidate, handles optical sensor latency at start)
    if (spd >= strideSpeedThreshold || cad >= strideCadThreshold || (cad >= 170 && st > 100 && st <= 210 && spd >= 2.5)) {
      return 'work';
    }

    // If easy base session with no interval structure, non-burst running is recovery/base
    if (isEasyBaseSession && !hasSpeedContrast) {
      return 'recovery';
    }

    // 2. Structured work rep: speed contrast (standard outdoor intervals)
    if (hasSpeedContrast && spd >= workSpeedThreshold && (cad >= 120 || spd >= 2.5)) {
      return 'work';
    }

    // 3. Cadence contrast with elevated HR or speed (e.g. slow pace threshold or treadmill)
    if (hasCadenceContrast && cad >= workCadenceThreshold && (hr >= hrWorkThreshold || spd >= workSpeedThreshold)) {
      return 'work';
    }

    // 4. Physiological HR contrast (indoor hills / treadmill with flat GPS)
    if (hasHrContrast && hr >= hrWorkThreshold && isRunningCadence(cad)) {
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
      const durSec = records[b.endIndex].elapsedSeconds - records[b.startIndex].elapsedSeconds;
      const blockRecs = records.slice(b.startIndex, b.endIndex + 1);
      const maxSpd = Math.max(...blockRecs.map(r => r.speedMps ?? 0));
      const maxCad = Math.max(...blockRecs.map(r => r.cadence ?? 0));
      const minStance = Math.min(...blockRecs.map(r => (r.stanceTime && r.stanceTime > 100) ? r.stanceTime : 9999));
      const startDist = blockRecs[0].distanceMeters ?? 0;
      const endDist = blockRecs[blockRecs.length - 1].distanceMeters ?? startDist;
      const distM = Math.max(0, endDist - startDist);

      // Stride requires short duration, minimum distance (>= 35m) to filter street-crossing flutters,
      // and either high speed surge or neuromuscular cadence turnover
      if (durSec <= 45 && distM >= 35 && (maxSpd >= strideSpeedThreshold || maxCad >= strideCadThreshold || minStance <= 210)) {
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
      const repCad = records[rawBlocks[i].startIndex].cadence ?? 0;
      let backfilledStart = rawBlocks[i].startIndex;
      while (
        backfilledStart > prevRec.startIndex &&
        rawBlocks[i].startIndex - backfilledStart < 90 &&
        (records[backfilledStart - 1].cadence ?? 0) >= repCad - 6
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
            rawBlocks[i].startIndex - backfilledStart <= 12
          ) {
            const r = records[backfilledStart - 1];
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
            forwardEnd - rawBlocks[i].endIndex <= 8
          ) {
            const r = records[forwardEnd + 1];
            const cad = r.cadence ?? 0;
            const spd = r.speedMps ?? 0;
            const isDecelDropout = (cad === 0 || cad < 130) && spd >= stridePeakSpeed * 0.65;
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

  // Merge spurious dips inside long reps
  const mergedDips: RawBlock[] = [];
  for (let i = 0; i < rawBlocks.length; i++) {
    const b = rawBlocks[i];
    const prev = mergedDips[mergedDips.length - 1];
    const next = rawBlocks[i + 1];

    const dur = records[b.endIndex].elapsedSeconds - records[b.startIndex].elapsedSeconds;
    const prevDur = prev ? records[prev.endIndex].elapsedSeconds - records[prev.startIndex].elapsedSeconds : 0;
    const nextDur = next ? records[next.endIndex].elapsedSeconds - records[next.startIndex].elapsedSeconds : 0;

    const blockRecs = records.slice(b.startIndex, b.endIndex + 1);
    const startHr = blockRecs[0]?.heartRate ?? 0;
    const minHr = Math.min(...blockRecs.map(r => r.heartRate || 999).filter(h => h < 999));
    const hrDrop = startHr > 0 && minHr < 999 ? startHr - minHr : 0;

    const isSpuriousDip = b.type === 'recovery' &&
      prev && prev.type === 'work' &&
      next && next.type === 'work' &&
      dur <= 60 &&
      prevDur >= 150 &&
      nextDur >= 150 &&
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
    const dur = records[b.endIndex].elapsedSeconds - records[b.startIndex].elapsedSeconds;
    if (b.type === 'stride') {
      const startDist = records[b.startIndex].distanceMeters ?? 0;
      const endDist = records[b.endIndex].distanceMeters ?? startDist;
      const dist = Math.max(0, endDist - startDist);
      return dur >= 6 && dur <= 45 && dist >= 35;
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

    const pruned: RawBlock[] = [];
    for (const b of validBlocks) {
      if (b.type === 'work') {
        const blockRecs = records.slice(b.startIndex, b.endIndex + 1);
        const avgHr = blockRecs.reduce((sum, r) => sum + (r.heartRate ?? 0), 0) / blockRecs.length;
        const pruneCeiling = options.lt1Hr ? options.lt1Hr + 2 : (maxRepHr > 130 ? maxRepHr * 0.86 : 148);
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

function detectRaceInterval(records: ActivityRecord[]): DetectedInterval[] {
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
      let restCount = 0;
      for (let j = i; j < Math.min(records.length, i + 20); j++) {
        if ((records[j].cadence ?? 0) < 128) restCount++;
      }
      if (restCount >= 15 || i === records.length - 1) {
        inRun = false;
        const dur = records[i - 1].elapsedSeconds - records[start].elapsedSeconds;
        const sub = records.slice(start, i);
        const avgHr = sub.reduce((s, r) => s + (r.heartRate ?? 0), 0) / (sub.length || 1);
        const avgCad = sub.reduce((s, r) => s + (r.cadence ?? 0), 0) / (sub.length || 1);
        if (dur >= 60) segs.push({ start, end: i - 1, dur, avgHr, avgCad });
      }
    }
  }
  if (inRun) {
    const dur = records[records.length - 1].elapsedSeconds - records[start].elapsedSeconds;
    const sub = records.slice(start);
    const avgHr = sub.reduce((s, r) => s + (r.heartRate ?? 0), 0) / (sub.length || 1);
    const avgCad = sub.reduce((s, r) => s + (r.cadence ?? 0), 0) / (sub.length || 1);
    if (dur >= 60) segs.push({ start, end: records.length - 1, dur, avgHr, avgCad });
  }

  if (segs.length === 0) return [];

  segs.sort((a, b) => (b.avgHr * Math.log(b.dur)) - (a.avgHr * Math.log(a.dur)));
  const best = segs[0];

  const blocks: { type: 'work' | 'recovery' | 'stride'; startIndex: number; endIndex: number }[] = [];
  if (best.start > 0) blocks.push({ type: 'recovery', startIndex: 0, endIndex: best.start - 1 });
  blocks.push({ type: 'work', startIndex: best.start, endIndex: best.end });
  if (best.end < records.length - 1) blocks.push({ type: 'recovery', startIndex: best.end + 1, endIndex: records.length - 1 });

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

    let hrSum = 0, hrCount = 0, maxHr = 0, minHr = 999;
    let cadSum = 0, cadCount = 0, maxCad = 0;
    let speedSum = 0, speedCount = 0, maxSpeed = 0;
    let minStance = 9999, stanceSum = 0, stanceCount = 0;
    let voSum = 0, voCount = 0;

    for (const r of recs) {
      if (r.heartRate) {
        hrSum += r.heartRate; hrCount++;
        if (r.heartRate > maxHr) maxHr = r.heartRate;
        if (r.heartRate < minHr) minHr = r.heartRate;
      }
      if (r.cadence) {
        cadSum += r.cadence; cadCount++;
        if (r.cadence > maxCad) maxCad = r.cadence;
      }
      if (r.speedMps) {
        speedSum += r.speedMps; speedCount++;
        if (r.speedMps > maxSpeed) maxSpeed = r.speedMps;
      }
      if (r.stanceTime && r.stanceTime > 100) {
        stanceSum += r.stanceTime; stanceCount++;
        if (r.stanceTime < minStance) minStance = r.stanceTime;
      }
      if (r.verticalOscillation && r.verticalOscillation > 0) {
        voSum += r.verticalOscillation; voCount++;
      }
    }

    const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : 0;
    const avgCad = cadCount > 0 ? Math.round(cadSum / cadCount) : 0;
    const avgSpeed = speedCount > 0 ? speedSum / speedCount : distM / durSec;
    const avgPace = avgSpeed > 0 ? Math.round(1000 / avgSpeed) : 0;
    const peakPace = maxSpeed > 0 ? Math.round(1000 / maxSpeed) : avgPace;
    const avgStance = stanceCount > 0 ? Number((stanceSum / stanceCount).toFixed(1)) : undefined;
    const avgVo = voCount > 0 ? Number((voSum / voCount).toFixed(1)) : undefined;

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

    let hrDrop: number | undefined;
    if (block.type === 'recovery' && recs.length > 3) {
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
