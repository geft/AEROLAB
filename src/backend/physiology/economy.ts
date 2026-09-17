import { ActivityRecord } from '../ingestion/csv-parser';

export interface PauseBreakdown {
  stopCount: number;
  stopDurationSeconds: number;
  walkCount: number;
  walkDurationSeconds: number;
  walkDistanceMeters: number;
  steadyRunningDurationSeconds: number;
  steadyRunningDistanceMeters: number;
  steadyPaceSecKm: number | null;
  steadyHeartRate: number | null;
  steadyCadence: number | null;
  steadyStanceTimeMs: number | null;
  steadyVertOscMm: number | null;
}

export interface EconomyMetrics {
  efficiencyFactor: number | null; // (m/min) / HR
  metersPerBeat: number | null;
  aerobicDecouplingPct: number | null; // Pa:Hr drift percentage
  movingDurationSeconds: number;
  movingDistanceMeters: number;
  avgMovingPaceSecKm: number | null;
  avgMovingHeartRate: number | null;
  firstHalfEf?: number | null;
  secondHalfEf?: number | null;
  steadyPaceSecKm?: number | null;
  steadyHeartRate?: number | null;
  steadyCadence?: number | null;
  steadyStanceTimeMs?: number | null;
  pauseBreakdown?: PauseBreakdown;
}

export interface SplitLap {
  splitIndex: number;
  distanceMeters: number;
  durationSeconds: number;
  avgPaceSecKm: number;
  avgHeartRate: number;
  splitEfficiencyFactor: number | null;
  elevationChangeM: number;
  avgCadence: number | null;
  avgStanceTimeMs: number | null;  // GCT in ms
  avgVertOscMm: number | null;     // Vertical Oscillation in mm
  avgVertRatioPct: number | null;  // Vertical Ratio = (VO_cm / stride_length_cm) * 100
}

/**
 * Isolates stationary pauses (traffic lights, water stops) and walk breaks
 * from pure steady-state running.
 */
export function extractSteadyStateMetrics(records: any[]): PauseBreakdown {
  if (!records || records.length === 0) {
    return {
      stopCount: 0,
      stopDurationSeconds: 0,
      walkCount: 0,
      walkDurationSeconds: 0,
      walkDistanceMeters: 0,
      steadyRunningDurationSeconds: 0,
      steadyRunningDistanceMeters: 0,
      steadyPaceSecKm: null,
      steadyHeartRate: null,
      steadyCadence: null,
      steadyStanceTimeMs: null,
      steadyVertOscMm: null
    };
  }

  let stopDur = 0, walkDur = 0, runDur = 0;
  let walkDist = 0, runDist = 0;
  let runHrSum = 0, runHrCount = 0;
  let runCadSum = 0, runCadCount = 0;
  let runSpeedSum = 0, runSpeedCount = 0;
  let runGctSum = 0, runGctCount = 0;
  let runVoSum = 0, runVoCount = 0;

  let currentBlockType: 'stop' | 'walk' | 'run' | null = null;
  let currentBlockDur = 0;
  let stopCount = 0;
  let walkCount = 0;

  const hasCadence = records.some(r => (r.cadence ?? r.cad ?? 0) > 50);

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const prev = i > 0 ? records[i - 1] : r;

    const rSec = r.elapsedSeconds ?? r.elapsed_seconds ?? i;
    const prevSec = prev.elapsedSeconds ?? prev.elapsed_seconds ?? Math.max(0, rSec - 1);
    const dtRaw = Math.max(1, rSec - prevSec);
    const dt = Math.min(15, dtRaw);

    const speed = r.speedMps ?? r.speed_mps ?? 0;
    const cad = r.cadence ?? r.cad ?? 0;
    const hr = r.heartRate ?? r.heart_rate;
    const gct = r.stanceTime ?? r.stance_time;
    const vo = r.verticalOscillation ?? r.vert_osc;

    const rDist = r.distanceMeters ?? r.distance_m ?? 0;
    const prevDist = prev.distanceMeters ?? prev.distance_m ?? 0;
    const rawDd = Math.max(0, rDist - prevDist);
    // When records have sampling gaps or downsampling, clamp dd to human running speeds (max 10 m/s)
    const dd = dtRaw <= 15 ? Math.min(dt * 10, rawDd) : (speed > 0 ? speed * dt : 0);

    // Breaks filtered strictly by cadence so slow running is preserved:
    // 1. Stationary / Pause: cadence < 50 (idle, waiting at traffic lights, tying shoes)
    // 2. Walk Break: cadence >= 50 && cadence < 126 (walking cadence)
    // 3. Steady Running: cadence >= 126 (running turnover, even at slow easy/recovery pace)
    let type: 'stop' | 'walk' | 'run' = 'run';
    if (hasCadence) {
      if (!cad || cad < 50) {
        type = 'stop';
      } else if (cad < 126) {
        type = 'walk';
      } else {
        type = 'run';
      }
    } else {
      // Fallback only if device records no cadence data at all
      if (speed < 0.6) {
        type = 'stop';
      } else if (speed < 1.6) {
        type = 'walk';
      } else {
        type = 'run';
      }
    }

    if (type !== currentBlockType) {
      if (currentBlockType === 'stop' && currentBlockDur >= 3) {
        stopCount++;
      } else if (currentBlockType === 'walk' && currentBlockDur >= 4) {
        walkCount++;
      }
      currentBlockType = type;
      currentBlockDur = dt;
    } else {
      currentBlockDur += dt;
    }

    if (type === 'stop') {
      stopDur += dt;
    } else if (type === 'walk') {
      walkDur += dt;
      walkDist += dd;
    } else {
      runDur += dt;
      runDist += dd;
      if (hr && hr > 40) { runHrSum += hr; runHrCount++; }
      if (cad && cad > 50) { runCadSum += cad; runCadCount++; }
      if (speed && speed > 0) { runSpeedSum += speed; runSpeedCount++; }
      if (gct && gct > 0) { runGctSum += gct; runGctCount++; }
      if (vo && vo > 0) { runVoSum += vo; runVoCount++; }
    }
  }

  if (currentBlockType === 'stop' && currentBlockDur >= 3) stopCount++;
  if (currentBlockType === 'walk' && currentBlockDur >= 4) walkCount++;

  let steadyPace: number | null = null;
  if (runDist > 100 && runDur > 30) {
    const pace = Math.round((runDur / runDist) * 1000);
    if (pace >= 150 && pace <= 1200) {
      steadyPace = pace;
    }
  }
  if (!steadyPace && runSpeedCount > 0 && runSpeedSum > 0) {
    const avgSpeed = runSpeedSum / runSpeedCount;
    if (avgSpeed > 0.2) {
      steadyPace = Math.round(1000 / avgSpeed);
    }
  }

  return {
    stopCount,
    stopDurationSeconds: Math.round(stopDur),
    walkCount,
    walkDurationSeconds: Math.round(walkDur),
    walkDistanceMeters: Math.round(walkDist),
    steadyRunningDurationSeconds: Math.round(runDur),
    steadyRunningDistanceMeters: Math.round(runDist),
    steadyPaceSecKm: steadyPace,
    steadyHeartRate: runHrCount > 0 ? Math.round(runHrSum / runHrCount) : null,
    steadyCadence: runCadCount > 0 ? Math.round(runCadSum / runCadCount) : null,
    steadyStanceTimeMs: runGctCount > 0 ? Number((runGctSum / runGctCount).toFixed(1)) : null,
    steadyVertOscMm: runVoCount > 0 ? Number((runVoSum / runVoCount).toFixed(1)) : null
  };
}

/**
 * Computes running economy metrics from time-series records.
 * Automatically discards pauses (traffic lights, stops) and walk breaks
 * so steady state calculations are completely unskewed.
 */
export function calculateEconomy(records: ActivityRecord[]): EconomyMetrics {
  const pauseBreakdown = extractSteadyStateMetrics(records);

  if (!records || records.length === 0) {
    return {
      efficiencyFactor: null,
      metersPerBeat: null,
      aerobicDecouplingPct: null,
      movingDurationSeconds: 0,
      movingDistanceMeters: 0,
      avgMovingPaceSecKm: null,
      avgMovingHeartRate: null,
      steadyPaceSecKm: null,
      steadyHeartRate: null,
      steadyCadence: null,
      steadyStanceTimeMs: null,
      pauseBreakdown
    };
  }

  // Filter moving records
  const movingRecords = records.filter(r => {
    const isMovingCadence = r.cadence !== null && r.cadence > 40;
    const isMovingSpeed = r.speedMps !== null && r.speedMps > 0.8;
    return isMovingCadence || isMovingSpeed;
  });

  // Pure steady-state running records (filtered purely by cadence so slow running is preserved)
  const hasCadenceInRecords = records.some(r => (r.cadence ?? 0) > 50);
  const steadyRunningRecords = records.filter(r => {
    const cad = r.cadence ?? 0;
    const speed = r.speedMps ?? 0;
    if (hasCadenceInRecords) {
      return cad >= 126;
    }
    return speed >= 1.6;
  });

  // Use steady running records if available; fallback to moving records if very short
  const activeRecords = steadyRunningRecords.length >= 10 ? steadyRunningRecords : movingRecords;

  if (activeRecords.length < 10) {
    return {
      efficiencyFactor: null,
      metersPerBeat: null,
      aerobicDecouplingPct: null,
      movingDurationSeconds: 0,
      movingDistanceMeters: 0,
      avgMovingPaceSecKm: null,
      avgMovingHeartRate: null,
      steadyPaceSecKm: pauseBreakdown.steadyPaceSecKm,
      steadyHeartRate: pauseBreakdown.steadyHeartRate,
      steadyCadence: pauseBreakdown.steadyCadence,
      steadyStanceTimeMs: pauseBreakdown.steadyStanceTimeMs,
      pauseBreakdown
    };
  }

  let totalSpeed = 0;
  let totalHr = 0;
  let hrCount = 0;
  let speedCount = 0;

  for (const r of activeRecords) {
    if (r.speedMps !== null && r.speedMps > 0) {
      totalSpeed += r.speedMps;
      speedCount++;
    }
    if (r.heartRate !== null && r.heartRate > 0) {
      totalHr += r.heartRate;
      hrCount++;
    }
  }

  // Moving distance & duration
  const startDist = activeRecords[0].distanceMeters ?? 0;
  const endDist = activeRecords[activeRecords.length - 1].distanceMeters ?? startDist;
  const movingDistanceMeters = Math.max(0, endDist - startDist);
  const firstSec = activeRecords[0].elapsedSeconds ?? 0;
  const lastSec = activeRecords[activeRecords.length - 1].elapsedSeconds ?? activeRecords.length;
  const movingDurationSeconds = Math.max(activeRecords.length, lastSec - firstSec);

  const rawAvgSpeedMps = speedCount > 0 ? totalSpeed / speedCount : 0;
  const fallbackSpeedMps = movingDurationSeconds > 0 ? movingDistanceMeters / movingDurationSeconds : 0;
  // Guard against corrupt sensor speed spikes or flat corrupt speed records:
  // If sensor speed wildly deviates from actual distance/time (>50% divergence), prefer distance/time.
  const avgSpeedMps = (rawAvgSpeedMps > 0 && fallbackSpeedMps > 0 && Math.abs(rawAvgSpeedMps - fallbackSpeedMps) / fallbackSpeedMps > 0.5)
    ? fallbackSpeedMps
    : (rawAvgSpeedMps > 0 ? rawAvgSpeedMps : fallbackSpeedMps);
  const avgHr = hrCount > 0 ? totalHr / hrCount : 0;

  // Efficiency Factor = Speed (m/min) / HR
  const speedMpm = avgSpeedMps * 60;
  const efficiencyFactor = avgHr > 0 && speedMpm > 0 ? Number((speedMpm / avgHr).toFixed(4)) : null;

  // Meters per Beat
  let metersPerBeat: number | null = null;
  if (avgHr > 0 && movingDurationSeconds > 0 && movingDistanceMeters > 0) {
    const totalBeats = (avgHr / 60) * movingDurationSeconds;
    metersPerBeat = Number((movingDistanceMeters / totalBeats).toFixed(3));
  }

  // Aerobic Decoupling (Pa:Hr): Compare first half EF vs second half EF on the body of the run.
  //
  // Warmup skip is ADAPTIVE via HR slope detection:
  //   • Scan the early records using a rolling window, computing local HR rise rate (bpm/sec)
  //   • Advance the body-start index until the slope drops below 0.15 bpm/sec (9 bpm/min)
  //   • Fast warmup ramps (15–25 bpm/min) get trimmed; runs that start at pace keep all data
  //   • Scan is capped at the first 20% so a genuinely drifting run is never over-trimmed
  //   • A minimal 3% noise guard is always applied regardless of slope
  let aerobicDecouplingPct: number | null = null;

  const minNoiseGuard = Math.max(1, Math.floor(activeRecords.length * 0.03));
  let warmupEndIdx = minNoiseGuard;

  if (activeRecords.length >= 30) {
    const windowSize = Math.max(5, Math.floor(activeRecords.length * 0.05));
    const maxScan = Math.floor(activeRecords.length * 0.20);

    for (let i = minNoiseGuard; i < maxScan - windowSize; i++) {
      const wStart = activeRecords[i];
      const wEnd = activeRecords[i + windowSize - 1];
      const hrStart = (wStart.heartRate ?? (wStart as any).heart_rate ?? 0) as number;
      const hrEnd   = (wEnd.heartRate   ?? (wEnd   as any).heart_rate ?? 0) as number;
      const tStart  = (wStart.elapsedSeconds ?? (wStart as any).elapsed_seconds ?? i) as number;
      const tEnd    = (wEnd.elapsedSeconds   ?? (wEnd   as any).elapsed_seconds ?? (i + windowSize)) as number;
      const dt = Math.max(1, tEnd - tStart);
      const slope = (hrEnd - hrStart) / dt; // bpm/sec

      if (slope < 0.15) {
        // HR has settled — start body here
        warmupEndIdx = i;
        break;
      }
      // Still rising — advance body start
      warmupEndIdx = i + 1;
    }
  }

  const bodyRecords = activeRecords.slice(warmupEndIdx);
  const midpoint = Math.floor(bodyRecords.length / 2);
  const firstHalf = bodyRecords.slice(0, midpoint);
  const secondHalf = bodyRecords.slice(midpoint);

  const ef1 = calculateHalfEF(firstHalf);
  const ef2 = calculateHalfEF(secondHalf);

  if (ef1 !== null && ef2 !== null && ef1 > 0) {
    aerobicDecouplingPct = Number((((ef1 - ef2) / ef1) * 100).toFixed(2));
  }

  const avgMovingPaceSecKm = avgSpeedMps > 0 ? Number((1000 / avgSpeedMps).toFixed(1)) : null;
  const avgMovingHeartRate = avgHr > 0 ? Math.round(avgHr) : null;

  return {
    efficiencyFactor,
    metersPerBeat,
    aerobicDecouplingPct,
    movingDurationSeconds,
    movingDistanceMeters,
    avgMovingPaceSecKm,
    avgMovingHeartRate,
    steadyPaceSecKm: pauseBreakdown.steadyPaceSecKm ?? (avgMovingPaceSecKm ? Math.round(avgMovingPaceSecKm) : null),
    steadyHeartRate: pauseBreakdown.steadyHeartRate ?? avgMovingHeartRate,
    steadyCadence: pauseBreakdown.steadyCadence,
    steadyStanceTimeMs: pauseBreakdown.steadyStanceTimeMs,
    pauseBreakdown
  };
}


function calculateHalfEF(halfRecords: ActivityRecord[]): number | null {
  let speedSum = 0;
  let speedCount = 0;
  let hrSum = 0;
  let hrCount = 0;

  for (const r of halfRecords) {
    if (r.speedMps !== null && r.speedMps > 0) {
      speedSum += r.speedMps;
      speedCount++;
    }
    if (r.heartRate !== null && r.heartRate > 0) {
      hrSum += r.heartRate;
      hrCount++;
    }
  }

  if (hrCount === 0) return null;
  const startDist = halfRecords[0].distanceMeters ?? 0;
  const endDist = halfRecords[halfRecords.length - 1].distanceMeters ?? startDist;
  const dist = Math.max(0, endDist - startDist);
  const dur = Math.max(1, (halfRecords[halfRecords.length - 1].elapsedSeconds - halfRecords[0].elapsedSeconds));
  const fallbackSpeed = dur > 0 ? dist / dur : 0;

  const rawAvg = speedCount > 0 ? speedSum / speedCount : fallbackSpeed;
  const avgSpeedMps = (rawAvg > 0 && fallbackSpeed > 0 && Math.abs(rawAvg - fallbackSpeed) / fallbackSpeed > 0.5)
    ? fallbackSpeed
    : (rawAvg > 0 ? rawAvg : fallbackSpeed);

  if (avgSpeedMps <= 0) return null;
  const avgSpeed = avgSpeedMps * 60; // m/min
  const avgHr = hrSum / hrCount;
  return avgHr > 0 ? avgSpeed / avgHr : null;
}

/**
 * Calculates kilometer-by-kilometer splits from records.
 */
export function calculateKmSplits(records: ActivityRecord[], splitDistanceMeters: number = 1000): SplitLap[] {
  if (!records || records.length === 0) return [];

  const splits: SplitLap[] = [];
  let currentSplitIndex = 1;
  let splitStartIndex = 0;
  let lastSplitDist = 0;

  for (let i = 0; i < records.length; i++) {
    const currentDist = records[i].distanceMeters ?? 0;
    const distInSplit = currentDist - lastSplitDist;

    if (distInSplit >= splitDistanceMeters || i === records.length - 1) {
      const splitRecords = records.slice(splitStartIndex, i + 1);
      if (splitRecords.length > 0) {
        const startRecord = splitRecords[0];
        const endRecord = splitRecords[splitRecords.length - 1];

        const durationSec = Math.max(1, endRecord.elapsedSeconds - startRecord.elapsedSeconds);
        const actualDist = Math.max(1, (endRecord.distanceMeters ?? 0) - (startRecord.distanceMeters ?? 0));

        let hrSum = 0, hrCount = 0;
        let speedSum = 0, speedCount = 0;
        let cadSum = 0, cadCount = 0;
        let stanceSum = 0, stanceCount = 0;
        let voSum = 0, voCount = 0;

        for (const r of splitRecords) {
          if (r.heartRate) { hrSum += r.heartRate; hrCount++; }
          if (r.speedMps) { speedSum += r.speedMps; speedCount++; }
          if (r.cadence && r.cadence > 50) { cadSum += r.cadence; cadCount++; }
          if (r.stanceTime && r.stanceTime > 100) { stanceSum += r.stanceTime; stanceCount++; }
          if (r.verticalOscillation && r.verticalOscillation > 0) { voSum += r.verticalOscillation; voCount++; }
        }

        const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : 0;
        const actualSpeedMps = durationSec > 0 ? actualDist / durationSec : 0;
        const rawSpeedMps = speedCount > 0 ? speedSum / speedCount : actualSpeedMps;
        const avgSpeedMps = (rawSpeedMps > 0 && actualSpeedMps > 0 && Math.abs(rawSpeedMps - actualSpeedMps) / actualSpeedMps > 0.5)
          ? actualSpeedMps
          : (rawSpeedMps > 0 ? rawSpeedMps : actualSpeedMps);
        const avgPaceSecKm = avgSpeedMps > 0 ? Math.round(1000 / avgSpeedMps) : 0;
        const avgCadence = cadCount > 0 ? Math.round(cadSum / cadCount) : null;
        const avgStanceTimeMs = stanceCount > 0 ? Number((stanceSum / stanceCount).toFixed(1)) : null;
        const avgVertOscMm = voCount > 0 ? Number((voSum / voCount).toFixed(1)) : null;

        // Vertical Ratio = vertical oscillation (cm) / stride length (cm) * 100
        // Stride length (m) = speed (m/s) / (cadence_spm / 60 / 2) [2 steps per stride]
        let avgVertRatioPct: number | null = null;
        if (avgVertOscMm && avgCadence && avgSpeedMps > 0 && avgCadence > 0) {
          const stepsPerSec = avgCadence / 60;
          const stridesPerSec = stepsPerSec / 2;
          const strideLengthCm = (avgSpeedMps / stridesPerSec) * 100;
          avgVertRatioPct = strideLengthCm > 0
            ? Number(((avgVertOscMm / 10) / strideLengthCm * 100).toFixed(2))
            : null;
        }

        const splitEf = avgHr > 0 && avgSpeedMps > 0
          ? Number(((avgSpeedMps * 60) / avgHr).toFixed(4))
          : null;

        const elevStart = startRecord.altitudeMeters ?? 0;
        const elevEnd = endRecord.altitudeMeters ?? 0;
        const elevationChangeM = Number((elevEnd - elevStart).toFixed(1));

        splits.push({
          splitIndex: currentSplitIndex,
          distanceMeters: Number(actualDist.toFixed(1)),
          durationSeconds: Number(durationSec.toFixed(1)),
          avgPaceSecKm,
          avgHeartRate: avgHr,
          splitEfficiencyFactor: splitEf,
          elevationChangeM,
          avgCadence,
          avgStanceTimeMs,
          avgVertOscMm,
          avgVertRatioPct
        });

        currentSplitIndex++;
        lastSplitDist = currentDist;
        splitStartIndex = i + 1;
      }
    }
  }

  return splits;
}
