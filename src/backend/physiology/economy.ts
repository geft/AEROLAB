import { ActivityRecord } from '../ingestion/csv-parser';
import { distanceSeries } from './distance-series.js';
import { observedIntervals } from './time-series.js';

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

type Movement = 'stop' | 'walk' | 'run';
type SensorRecord = Pick<ActivityRecord, 'elapsedSeconds' | 'distanceMeters' | 'speedMps' | 'cadence' | 'heartRate' | 'stanceTime' | 'verticalOscillation'>;

// Accept ingestion and stored-record field names at this existing API boundary.
function normalize(records: any[]): SensorRecord[] {
  return (records ?? []).map(r => ({
    elapsedSeconds: r.elapsedSeconds ?? r.elapsed_seconds,
    distanceMeters: r.distanceMeters ?? r.distance_m,
    speedMps: r.speedMps ?? r.speed_mps,
    cadence: r.cadence ?? r.cad,
    heartRate: r.heartRate ?? r.heart_rate,
    stanceTime: r.stanceTime ?? r.stance_time,
    verticalOscillation: r.verticalOscillation ?? r.vert_osc
  }));
}
const finite = (v: number | null | undefined, floor = 0): v is number => v != null && Number.isFinite(v) && v > floor;

function runningEvidence(records: SensorRecord[]) {
  const hasCadence = records.some(r => finite(r.cadence, 50));
  const movement = (r: SensorRecord): Movement => hasCadence
    ? (!finite(r.cadence, 49) ? 'stop' : r.cadence! < 126 ? 'walk' : 'run')
    : (!finite(r.speedMps, 0.6) ? 'stop' : r.speedMps! < 1.6 ? 'walk' : 'run');
  return observedIntervals(records, r => r.elapsedSeconds).map(interval => {
    const { a, b, seconds } = interval;
    const type = movement(b);
    const sameMovement = movement(a) === type;
    const mean = (key: 'heartRate' | 'cadence' | 'speedMps' | 'stanceTime' | 'verticalOscillation', floor = 0): number | null => {
      if (!finite(b[key], floor)) return null;
      if (!sameMovement) return b[key]!;
      return finite(a[key], floor) ? (a[key]! + b[key]!) / 2 : null;
    };
    const dd = finite(a.distanceMeters, -1) && finite(b.distanceMeters, -1) && b.distanceMeters >= a.distanceMeters
      ? Math.min(seconds * 10, b.distanceMeters - a.distanceMeters) : null;
    const sensorSpeed = mean('speedMps');
    const distanceSpeed = dd != null && dd > 0 ? dd / seconds : null;
    const speed = sensorSpeed != null && sensorSpeed <= 8.5 &&
      (distanceSpeed == null || Math.abs(sensorSpeed - distanceSpeed) / distanceSpeed <= 0.35)
      ? sensorSpeed : distanceSpeed;
    const hr = mean('heartRate', 40);
    const speedA = sameMovement && finite(a.speedMps) && sensorSpeed === speed ? a.speedMps : speed;
    const speedB = sameMovement && finite(b.speedMps) && sensorSpeed === speed ? b.speedMps : speed;
    const hrA = sameMovement && finite(a.heartRate, 40) ? a.heartRate : hr;
    const hrB = sameMovement && finite(b.heartRate, 40) ? b.heartRate : hr;
    return { ...interval, type, mean, distance: dd ?? ((speed ?? 0) * seconds), speed, hr, speedA, speedB, hrA, hrB };
  });
}

/** Pauses and walking are classified before integration, using original adjacent records. */
export function extractSteadyStateMetrics(records: any[]): PauseBreakdown {
  const evidence = runningEvidence(normalize(records));
  const totals = { stop: 0, walk: 0, run: 0 };
  let runDistance = 0, walkDistance = 0, stopCount = 0, walkCount = 0;
  const weights = { heartRate: { sum: 0, seconds: 0 }, cadence: { sum: 0, seconds: 0 },
    speedMps: { sum: 0, seconds: 0 }, stanceTime: { sum: 0, seconds: 0 }, verticalOscillation: { sum: 0, seconds: 0 } };
  let block: Movement | null = null, blockSeconds = 0, lastTime: number | null = null;
  const finish = () => {
    if (block === 'stop' && blockSeconds >= 3) stopCount++;
    if (block === 'walk' && blockSeconds >= 4) walkCount++;
  };
  for (const item of evidence) {
    if (item.type !== block || item.from !== lastTime) { finish(); block = item.type; blockSeconds = 0; }
    blockSeconds += item.seconds;
    lastTime = item.to;
    totals[item.type] += item.seconds;
    if (item.type === 'walk') walkDistance += item.distance;
    if (item.type !== 'run') continue;
    runDistance += item.distance;
    for (const key of Object.keys(weights) as Array<keyof typeof weights>) {
      const value = item.mean(key, key === 'heartRate' ? 40 : 0);
      if (value != null) { weights[key].sum += value * item.seconds; weights[key].seconds += item.seconds; }
    }
  }
  finish();
  const avg = (key: keyof typeof weights) => weights[key].seconds > 0 ? weights[key].sum / weights[key].seconds : null;
  const speed = runDistance > 0 && totals.run > 0 ? runDistance / totals.run : avg('speedMps');
  const round = (value: number | null, digits = 0) => value == null ? null : Number(value.toFixed(digits));
  return {
    stopCount, stopDurationSeconds: Math.round(totals.stop), walkCount, walkDurationSeconds: Math.round(totals.walk),
    walkDistanceMeters: Math.round(walkDistance), steadyRunningDurationSeconds: Math.round(totals.run),
    steadyRunningDistanceMeters: Math.round(runDistance), steadyPaceSecKm: speed && speed > 0.2 ? Math.round(1000 / speed) : null,
    steadyHeartRate: round(avg('heartRate')), steadyCadence: round(avg('cadence')),
    steadyStanceTimeMs: round(avg('stanceTime'), 1), steadyVertOscMm: round(avg('verticalOscillation'), 1)
  };
}

/** Integrates paired speed/HR over observed running time, excluding sensor and recording gaps. */
export function calculateEconomy(records: ActivityRecord[]): EconomyMetrics {
  const pauseBreakdown = extractSteadyStateMetrics(records);
  const evidence = runningEvidence(normalize(records)).filter(item => item.type === 'run');
  let activeTime = 0, pairedTime = 0;
  const body = evidence.map(item => {
    const start = activeTime;
    const pairedBefore = pairedTime;
    const paired = item.speedA != null && item.speedB != null && item.hrA != null && item.hrB != null;
    if (paired) pairedTime += item.seconds;
    activeTime += item.seconds;
    return { ...item, start, end: activeTime, pairedBefore, paired };
  });
  const integrate = (from: number, to: number) => {
    let distance = 0, hrTime = 0, seconds = 0;
    for (const item of body) {
      const start = Math.max(from, item.start), end = Math.min(to, item.end);
      if (end <= start || item.speedA == null || item.speedB == null || item.hrA == null || item.hrB == null) continue;
      const blend = (a: number, b: number, at: number) => a + (b - a) * (at - item.start) / item.seconds;
      const dt = end - start;
      distance += (blend(item.speedA, item.speedB, start) + blend(item.speedA, item.speedB, end)) / 2 * dt;
      hrTime += (blend(item.hrA, item.hrB, start) + blend(item.hrA, item.hrB, end)) / 2 * dt;
      seconds += dt;
    }
    return { distance, hrTime, seconds, ef: hrTime > 0 && distance > 0 ? distance * 60 / hrTime : null };
  };
  const total = integrate(0, activeTime);
  // Scan in active seconds. Never compare HR across pauses or missing telemetry.
  let warmupEnd = activeTime * 0.03;
  const window = Math.max(5, activeTime * 0.05), cap = activeTime * 0.20;
  let cursor = 0;
  const hrAt = (at: number) => {
    while (cursor + 1 < body.length && body[cursor].end < at) cursor++;
    const item = body[cursor];
    if (!item || item.hrA == null || item.hrB == null || at < item.start || at > item.end) return null;
    return { hr: item.hrA + (item.hrB - item.hrA) * (at - item.start) / item.seconds,
      elapsed: item.from + at - item.start,
      coverage: item.pairedBefore + (item.paired ? at - item.start : 0) };
  };
  if (activeTime >= 30) {
    // Two monotone lookups keep the warm-up scan linear in duration and records.
    let endCursor = 0;
    for (let at = warmupEnd; at + window <= cap; at += 1) {
      const first = hrAt(at);
      while (endCursor + 1 < body.length && body[endCursor].end < at + window) endCursor++;
      const item = body[endCursor];
      if (!first || !item || item.hrA == null || item.hrB == null) continue;
      const endHr = item.hrA + (item.hrB - item.hrA) * (at + window - item.start) / item.seconds;
      const elapsed = item.from + at + window - item.start;
      const coverage = item.pairedBefore + (item.paired ? at + window - item.start : 0) - first.coverage;
      if (Math.abs(elapsed - first.elapsed - window) > 0.001 || coverage < window - 0.001) continue;
      warmupEnd = at;
      if ((endHr - first.hr) / window < 0.15) break;
    }
  }
  const midpoint = warmupEnd + (activeTime - warmupEnd) / 2;
  const first = integrate(warmupEnd, midpoint), second = integrate(midpoint, activeTime);
  const ef1 = first.ef, ef2 = second.ef;
  const hasEvidence = total.seconds >= 10;
  const avgSpeed = total.seconds > 0 ? total.distance / total.seconds : 0;
  const avgHr = total.seconds > 0 ? total.hrTime / total.seconds : 0;
  const efficiencyFactor = hasEvidence && total.ef != null ? Number(Math.min(total.ef, 2.20).toFixed(4)) : null;
  return {
    efficiencyFactor, metersPerBeat: efficiencyFactor == null ? null : Number(efficiencyFactor.toFixed(3)),
    aerobicDecouplingPct: hasEvidence && ef1 != null && ef2 != null && ef1 > 0
      ? Number(((ef1 - ef2) / ef1 * 100).toFixed(2)) : null,
    firstHalfEf: ef1, secondHalfEf: ef2,
    movingDurationSeconds: Math.round(activeTime), movingDistanceMeters: pauseBreakdown.steadyRunningDistanceMeters,
    avgMovingPaceSecKm: hasEvidence && avgSpeed > 0 ? Number((1000 / avgSpeed).toFixed(1)) : null,
    avgMovingHeartRate: hasEvidence && avgHr > 0 ? Math.round(avgHr) : null,
    steadyPaceSecKm: pauseBreakdown.steadyPaceSecKm, steadyHeartRate: pauseBreakdown.steadyHeartRate,
    steadyCadence: pauseBreakdown.steadyCadence, steadyStanceTimeMs: pauseBreakdown.steadyStanceTimeMs, pauseBreakdown
  };
}

/**
 * Calculates kilometer-by-kilometer splits from records.
 */
export function calculateKmSplits(records: ActivityRecord[], splitDistanceMeters: number = 1000): SplitLap[] {
  if (!records || records.length < 2 || !Number.isFinite(splitDistanceMeters) || splitDistanceMeters <= 0) return [];
  const splits: SplitLap[] = [];
  const metricFloors = { heartRate: 0, cadence: 50, stanceTime: 100, verticalOscillation: 0 } as const;
  type Metric = keyof typeof metricFloors;
  const metrics = Object.keys(metricFloors) as Metric[];
  const emptyWeights = () => Object.fromEntries(metrics.map(key => [key, { sum: 0, seconds: 0 }])) as Record<Metric, { sum: number; seconds: number }>;
  const interpolate = (start: number | null, end: number | null, fraction: number): number | null =>
    start != null && end != null && Number.isFinite(start) && Number.isFinite(end)
      ? start + (end - start) * fraction : null;

  // Process each original interval once, dividing it at exact distance boundaries.
  // Runtime is O(records + splits); no samples disappear between adjacent laps.
  for (const points of distanceSeries(records)) {
    let startMeters = points[0].meters;
    let startSeconds = points[0].seconds;
    let startAltitude = points[0].record.altitudeMeters;
    let weights = emptyWeights();
    const finishSplit = (endMeters: number, endSeconds: number, endAltitude: number | null) => {
      const distance = endMeters - startMeters;
      const duration = endSeconds - startSeconds;
      if (distance > 0 && duration > 0) {
        const mean = (key: Metric) => weights[key].seconds > 0 ? weights[key].sum / weights[key].seconds : null;
        const hr = mean('heartRate');
        const cadence = mean('cadence');
        const stance = mean('stanceTime');
        const vo = mean('verticalOscillation');
        const speed = distance / duration;
        const strideLengthCm = cadence && cadence > 0 ? speed / (cadence / 120) * 100 : 0;
        splits.push({
          splitIndex: splits.length + 1,
          distanceMeters: Number(distance.toFixed(1)),
          durationSeconds: Number(duration.toFixed(1)),
          avgPaceSecKm: Math.round(1000 / speed),
          avgHeartRate: hr == null ? 0 : Math.round(hr),
          splitEfficiencyFactor: hr && hr > 0 ? Number((speed * 60 / hr).toFixed(4)) : null,
          elevationChangeM: startAltitude != null && endAltitude != null && Number.isFinite(startAltitude) && Number.isFinite(endAltitude)
            ? Number((endAltitude - startAltitude).toFixed(1)) : 0,
          avgCadence: cadence == null ? null : Math.round(cadence),
          avgStanceTimeMs: stance == null ? null : Number(stance.toFixed(1)),
          avgVertOscMm: vo == null ? null : Number(vo.toFixed(1)),
          avgVertRatioPct: vo && strideLengthCm > 0 ? Number((vo / 10 / strideLengthCm * 100).toFixed(2)) : null
        });
      }
      startMeters = endMeters;
      startSeconds = endSeconds;
      startAltitude = endAltitude;
      weights = emptyWeights();
    };

    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1];
      const current = points[index];
      const distance = current.meters - previous.meters;
      const seconds = current.seconds - previous.seconds;
      let fractionStart = 0;
      while (fractionStart < 1) {
        const boundary = startMeters + splitDistanceMeters;
        // A distance smaller than floating-point resolution must not stall the loop.
        if (boundary <= startMeters) return splits;
        const endMeters = Math.min(current.meters, boundary);
        const fractionEnd = distance > 0 ? (endMeters - previous.meters) / distance : 1;
        const duration = (fractionEnd - fractionStart) * seconds;
        for (const key of metrics) {
          const startValue = previous.record[key];
          const endValue = current.record[key];
          if (startValue == null || endValue == null || !Number.isFinite(startValue) || !Number.isFinite(endValue) ||
              startValue <= metricFloors[key] || endValue <= metricFloors[key]) continue;
          const from = startValue + (endValue - startValue) * fractionStart;
          const to = startValue + (endValue - startValue) * fractionEnd;
          weights[key].sum += (from + to) / 2 * duration;
          weights[key].seconds += duration;
        }
        if (endMeters === boundary) {
          finishSplit(endMeters, previous.seconds + fractionEnd * seconds,
            interpolate(previous.record.altitudeMeters, current.record.altitudeMeters, fractionEnd));
        }
        fractionStart = fractionEnd;
      }
    }
    const last = points[points.length - 1];
    finishSplit(last.meters, last.seconds, last.record.altitudeMeters);
  }
  return splits;
}
