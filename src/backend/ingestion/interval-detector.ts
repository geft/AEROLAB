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
  hrDrop?: number; // drop in heart rate during recovery
}

/**
 * Detects structured workout intervals (reps and recoveries) and strides using cadence & speed change points.
 */
export function detectIntervals(records: ActivityRecord[]): DetectedInterval[] {
  if (!records || records.length < 60) return [];

  // 1. Identify speed distribution and contrast.
  //    Interval sessions exhibit distinct separation between recovery and work speeds.
  //    Easy runs have minimal spread between 85th and 20th percentiles.
  const movingSpeeds = records
    .map(r => r.speedMps ?? 0)
    .filter(s => s > 0.5)
    .sort((a, b) => a - b);

  const sessionMaxHr = Math.max(...records.map(r => r.heartRate ?? 0));
  const hrWorkThreshold = sessionMaxHr > 140 ? sessionMaxHr * 0.82 : 160;

  let workSpeedThreshold = Infinity;
  let hasSpeedContrast = false;

  if (movingSpeeds.length > 30) {
    const p85 = movingSpeeds[Math.floor(movingSpeeds.length * 0.85)];
    const p50 = movingSpeeds[Math.floor(movingSpeeds.length * 0.50)];
    const p20 = movingSpeeds[Math.floor(movingSpeeds.length * 0.20)];
    // Meaningful speed separation where work reps are actively fast (>= 3.2 m/s or < 5:12/km)
    if ((p85 - p50 >= 0.6 && p85 >= 3.2) || (p85 - p20 >= 0.8 && p85 >= 3.2)) {
      hasSpeedContrast = true;
      // Work threshold sits cleanly above the jogging pace (p50)
      workSpeedThreshold = Math.max(3.3, (p85 + Math.max(p20, p50)) / 2);
    }
  }

  // 2. Label each second as active work or recovery
  const states: ('work' | 'recovery')[] = records.map(r => {
    const cad = r.cadence ?? 0;
    const spd = r.speedMps ?? 0;
    const hr  = r.heartRate ?? 0;

    // Stride candidate: fast turnover burst or high speed surge
    if (spd >= 4.0 || (spd >= 3.4 && cad >= 165)) {
      return 'work';
    }

    if (hasSpeedContrast) {
      return (spd >= workSpeedThreshold && (cad >= 145 || spd >= 3.8)) ? 'work' : 'recovery';
    }

    // HR fallback for treadmill / hill workouts without GPS speed gap
    if (sessionMaxHr >= 160 && hr >= hrWorkThreshold && cad >= 145 && spd >= 2.5) {
      return 'work';
    }

    return 'recovery';
  });

  // 3. Smooth state to remove single-second noise (window of 2s to preserve 5-15s strides)
  const smoothed: ('work' | 'recovery')[] = [];
  const windowSize = 2;
  for (let i = 0; i < states.length; i++) {
    let workVotes = 0;
    let totalVotes = 0;
    for (let w = -windowSize; w <= windowSize; w++) {
      const idx = i + w;
      if (idx >= 0 && idx < states.length) {
        if (states[idx] === 'work') workVotes++;
        totalVotes++;
      }
    }
    smoothed.push(workVotes / totalVotes >= 0.5 ? 'work' : 'recovery');
  }

  // 4. Segment into continuous blocks
  interface RawBlock {
    type: 'work' | 'recovery';
    startIndex: number;
    endIndex: number;
  }

  const rawBlocks: RawBlock[] = [];
  let currentType = smoothed[0];
  let startIndex = 0;

  for (let i = 1; i < smoothed.length; i++) {
    if (smoothed[i] !== currentType) {
      rawBlocks.push({ type: currentType, startIndex, endIndex: i - 1 });
      currentType = smoothed[i];
      startIndex = i;
    }
  }
  rawBlocks.push({ type: currentType, startIndex, endIndex: smoothed.length - 1 });

  // Merge tiny blips (< 8s) ONLY if they are not fast strides/surges
  const mergedBlocks: RawBlock[] = [];
  for (const b of rawBlocks) {
    const dur = records[b.endIndex].elapsedSeconds - records[b.startIndex].elapsedSeconds;
    const blockRecs = records.slice(b.startIndex, b.endIndex + 1);
    const maxSpd = Math.max(...blockRecs.map(r => r.speedMps ?? 0));
    const isStrideBurst = b.type === 'work' && (maxSpd >= 3.5 || dur >= 5);

    if (dur < 8 && !isStrideBurst && mergedBlocks.length > 0) {
      mergedBlocks[mergedBlocks.length - 1].endIndex = b.endIndex;
    } else {
      mergedBlocks.push({ ...b });
    }
  }

  // 5. Filter out transient blocks (< 5s for fast strides, < 15s for work, < 10s for recovery)
  const validBlocks = mergedBlocks.filter(b => {
    const dur = records[b.endIndex].elapsedSeconds - records[b.startIndex].elapsedSeconds;
    const blockRecs = records.slice(b.startIndex, b.endIndex + 1);
    const maxSpd = Math.max(...blockRecs.map(r => r.speedMps ?? 0));
    if (b.type === 'work') {
      if (maxSpd >= 3.5) return dur >= 5;
      return dur >= 15;
    }
    return dur >= 10;
  });

  const activeCount = validBlocks.filter(b => b.type === 'work').length;
  if (activeCount === 0) {
    return [];
  }

  const intervals: DetectedInterval[] = [];
  let intervalIndex = 1;

  for (let bIdx = 0; bIdx < validBlocks.length; bIdx++) {
    const block = validBlocks[bIdx];
    const blockRecords = records.slice(block.startIndex, block.endIndex + 1);
    if (blockRecords.length === 0) continue;

    const startSec = blockRecords[0].elapsedSeconds;
    const endSec = blockRecords[blockRecords.length - 1].elapsedSeconds;
    const durSec = Math.max(1, endSec - startSec);

    const startDist = blockRecords[0].distanceMeters ?? 0;
    const endDist = blockRecords[blockRecords.length - 1].distanceMeters ?? startDist;
    const distM = Math.max(0, endDist - startDist);

    let hrSum = 0;
    let hrCount = 0;
    let maxHr = 0;
    let minHr = 999;
    let cadSum = 0;
    let cadCount = 0;
    let maxCad = 0;
    let speedSum = 0;
    let speedCount = 0;
    let maxSpeed = 0;
    let minStance = 9999;

    for (const r of blockRecords) {
      if (r.heartRate) {
        hrSum += r.heartRate;
        hrCount++;
        if (r.heartRate > maxHr) maxHr = r.heartRate;
        if (r.heartRate < minHr) minHr = r.heartRate;
      }
      if (r.cadence) {
        cadSum += r.cadence;
        cadCount++;
        if (r.cadence > maxCad) maxCad = r.cadence;
      }
      if (r.speedMps) {
        speedSum += r.speedMps;
        speedCount++;
        if (r.speedMps > maxSpeed) maxSpeed = r.speedMps;
      }
      if (r.stanceTime && r.stanceTime > 100) {
        if (r.stanceTime < minStance) minStance = r.stanceTime;
      }
    }

    const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : 0;
    const avgCad = cadCount > 0 ? Math.round(cadSum / cadCount) : 0;
    const avgSpeed = speedCount > 0 ? speedSum / speedCount : distM / durSec;
    const avgPace = avgSpeed > 0 ? Math.round(1000 / avgSpeed) : 0;
    const peakPace = maxSpeed > 0 ? Math.round(1000 / maxSpeed) : avgPace;

    let hrDrop: number | undefined;
    if (block.type === 'recovery' && blockRecords.length > 3) {
      const initialHr = blockRecords[0].heartRate ?? avgHr;
      const validHrs = blockRecords.map(r => r.heartRate || 999).filter(h => h < 999);
      const minHrInBlock = validHrs.length > 0 ? Math.min(...validHrs) : initialHr;
      hrDrop = Math.max(0, initialHr - minHrInBlock);
    }

    // Detect stride: short active burst (<= 45s) with high peak speed (>= 3.4 m/s) or high cadence (>= 185 spm)
    let assignedType: 'work' | 'recovery' | 'stride' = block.type;
    if (block.type === 'work' && durSec <= 45 && (maxSpeed >= 3.4 || maxCad >= 185)) {
      assignedType = 'stride';
    } else if (block.type === 'work' && durSec < 90 && avgPace > 300 && maxHr < 165 && maxSpeed < 3.4) {
      // Warm-up or drill acceleration below threshold intensity
      assignedType = 'recovery';
    }

    intervals.push({
      intervalIndex: intervalIndex++,
      type: assignedType,
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
      hrDrop
    });
  }

  // Merge consecutive intervals of the same assignedType (e.g. adjacent recoveries)
  const mergedIntervals: DetectedInterval[] = [];
  for (const inv of intervals) {
    const last = mergedIntervals[mergedIntervals.length - 1];
    if (last && last.type === inv.type) {
      const totalDur = last.durationSeconds + inv.durationSeconds;
      const totalDist = last.distanceMeters + inv.distanceMeters;
      const avgSpd = totalDur > 0 ? totalDist / totalDur : 0;
      const avgP = avgSpd > 0 ? Math.round(1000 / avgSpd) : 0;
      last.durationSeconds = Number(totalDur.toFixed(1));
      last.distanceMeters = Number(totalDist.toFixed(1));
      last.avgSpeedMps = Number(avgSpd.toFixed(2));
      last.avgPaceSecKm = avgP;
      last.maxHeartRate = Math.max(last.maxHeartRate, inv.maxHeartRate);
      if (inv.peakSpeedMps && (!last.peakSpeedMps || inv.peakSpeedMps > last.peakSpeedMps)) {
        last.peakSpeedMps = inv.peakSpeedMps;
        last.peakPaceSecKm = inv.peakPaceSecKm;
      }
      if (inv.peakCadence && (!last.peakCadence || inv.peakCadence > last.peakCadence)) {
        last.peakCadence = inv.peakCadence;
      }
      if (inv.hrDrop && (!last.hrDrop || inv.hrDrop > last.hrDrop)) {
        last.hrDrop = inv.hrDrop;
      }
    } else {
      mergedIntervals.push({ ...inv, intervalIndex: mergedIntervals.length + 1 });
    }
  }

  return mergedIntervals;
}
