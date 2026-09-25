import { getAthleteHeartRateProfile } from './athlete-profile.js';
import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { rollingThreshold, type ThresholdObservation } from '../../shared/threshold-trend.js';
import Database from 'better-sqlite3';
import { ActivityMetadata, ActivityRecord } from '../ingestion/csv-parser';
import { EconomyMetrics } from './economy';
import { RunType } from '../ingestion/classifier';

export interface ThresholdEstimate {
  lt1Hr: number | null;
  lt1PaceSecKm: number | null;
  lt2Hr: number | null;
  lt2PaceSecKm: number | null;
  baselineEconomyEf: number | null;
}

export interface SplitRow {
  split_index: number;
  distance_meters: number;
  duration_seconds: number;
  avg_pace_sec_km: number;
  avg_heart_rate: number;
  elevation_change_m?: number;
}

export interface CruisingBlock {
  startSplit: number;
  endSplit: number;
  durationSec: number;
  distMeters: number;
  avgHr: number;
  avgPaceSecKm: number;
  decouplingPct: number;
}

function dbRow(value: unknown, table: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${table} row`);
  return value as Record<string, unknown>;
}
function dbNumber(row: Record<string, unknown>, key: string, table: string, nullable = false): number | null {
  const value = row[key];
  if (nullable && value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${table}.${key}`);
  return value;
}
function dbText(row: Record<string, unknown>, key: string, table: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${table}.${key}`);
  return value;
}
function thresholdObservations(values: unknown[], table: string): ThresholdObservation[] {
  return values.map(value => {
    const row = dbRow(value, table);
    return {
      hr: dbNumber(row, 'hr', table)!, pace: dbNumber(row, 'pace', table, true),
      confidence: dbNumber(row, 'confidence', table)!, effective_date: dbText(row, 'effective_date', table)
    };
  });
}

function profileRange(value: unknown): { lt1_min_hr: number | null; lt1_max_hr: number | null } | null {
  if (value == null) return null;
  const row = dbRow(value, 'athlete_profile');
  return {
    lt1_min_hr: dbNumber(row, 'lt1_min_hr', 'athlete_profile', true),
    lt1_max_hr: dbNumber(row, 'lt1_max_hr', 'athlete_profile', true)
  };
}

export function findAerobicCruisingBlock(
  splits: SplitRow[],
  maxLt1Hr: number,
  stimulusFloorHr: number,
  recentBaselinePace?: number | null
): CruisingBlock | null {
  const isCandidateSplit = (s: SplitRow) =>
    s.distance_meters >= 700 &&
    s.avg_pace_sec_km >= 120 &&
    s.avg_pace_sec_km <= 1200 &&
    s.avg_heart_rate > 40 &&
    Math.abs(s.elevation_change_m ?? 0) < 30;

  if (splits.length < 3) return null;

  // Only the first hour is eligible for calibration. A locally steady block
  // late in a long run can follow substantial accumulated cardiac drift.
  // Keep elapsed time across hills, recovery splits and gaps; never restart it.
  const elapsedAtEnd = new Map<SplitRow, number>();
  let elapsed = 0;
  let previousIndex = 0;
  for (const split of splits) {
    if (split.split_index !== previousIndex + 1) elapsed = Infinity;
    elapsed += split.duration_seconds;
    elapsedAtEnd.set(split, elapsed);
    previousIndex = split.split_index;
  }

  // Group into strictly contiguous segments to prevent non-consecutive split bridging
  const contiguousSegments: SplitRow[][] = [];
  let currentSegment: SplitRow[] = [];

  for (let i = 0; i < splits.length; i++) {
    const s = splits[i];
    if (isCandidateSplit(s)) {
      if (currentSegment.length === 0) {
        currentSegment.push(s);
      } else {
        const prev = currentSegment[currentSegment.length - 1];
        if (s.split_index === prev.split_index + 1) {
          currentSegment.push(s);
        } else {
          if (currentSegment.length >= 3) {
            contiguousSegments.push([...currentSegment]);
          }
          currentSegment = [s];
        }
      }
    } else {
      if (currentSegment.length >= 3) {
        contiguousSegments.push([...currentSegment]);
      }
      currentSegment = [];
    }
  }
  if (currentSegment.length >= 3) {
    contiguousSegments.push(currentSegment);
  }

  let bestBlock: CruisingBlock | null = null;

  for (const seg of contiguousSegments) {
    for (let len = 3; len <= seg.length; len++) {
      for (let start = 0; start <= seg.length - len; start++) {
        const window = seg.slice(start, start + len);
        if ((elapsedAtEnd.get(window[window.length - 1]) ?? Infinity) > 3600) continue;

        const totalDur = window.reduce((acc, s) => acc + s.duration_seconds, 0);
        const totalDist = window.reduce((acc, s) => acc + s.distance_meters, 0);

        // Require at least 20 minutes and 3.5 km of continuous steady aerobic running.
        if (totalDur < 1200 || totalDist < 3500) continue;

        const avgHr = window.reduce((acc, s) => acc + s.avg_heart_rate * s.duration_seconds, 0) / totalDur;
        const avgPace = (totalDur / totalDist) * 1000;

        // Must be within aerobic ceiling (not in Zone 4 / LT2)
        if (avgHr > maxLt1Hr) continue;

        // Individual splits cannot spike into LT2
        if (window.some(s => s.avg_heart_rate > maxLt1Hr + 3)) continue;

        // Internal decoupling between first half and second half of window
        const midPoint = Math.floor(window.length / 2);
        const firstHalf = window.slice(0, midPoint);
        const secondHalf = window.slice(midPoint);

        const firstDur = firstHalf.reduce((acc, s) => acc + s.duration_seconds, 0);
        const firstDist = firstHalf.reduce((acc, s) => acc + s.distance_meters, 0);
        const firstHr = firstHalf.reduce((acc, s) => acc + s.avg_heart_rate * s.duration_seconds, 0) / firstDur;
        const firstSpeed = firstDist / firstDur;
        const firstEf = (firstSpeed * 60) / firstHr;

        const secondDur = secondHalf.reduce((acc, s) => acc + s.duration_seconds, 0);
        const secondDist = secondHalf.reduce((acc, s) => acc + s.distance_meters, 0);
        const secondHr = secondHalf.reduce((acc, s) => acc + s.avg_heart_rate * s.duration_seconds, 0) / secondDur;
        const secondSpeed = secondDist / secondDur;
        const secondEf = (secondSpeed * 60) / secondHr;

        const decouplingPct = firstEf > 0 ? ((firstEf - secondEf) / firstEf) * 100 : 0;

        // Steady aerobic run: decoupling between -8.0% and 3.8%
        if (decouplingPct > 3.8 || decouplingPct < -8.0) continue;

        // Do not reset the drift clock by selecting a later plateau. Compare
        // with an earlier continuous 20-minute block at comparable speed,
        // excluding the first ten minutes of warmup.
        const windowStart = (elapsedAtEnd.get(window[0]) ?? Infinity) - window[0].duration_seconds;
        const candidateEf = (totalDist / totalDur * 60) / avgHr;
        let accumulatedDrift = false;
        for (const earlier of contiguousSegments) {
          for (let r = 0; r < earlier.length; r++) {
            const first = earlier[r];
            if ((elapsedAtEnd.get(first)! - first.duration_seconds) < 600) continue;
            let refDur = 0, refDist = 0, refHrSum = 0;
            for (let q = r; q < earlier.length; q++) {
              const s = earlier[q];
              if (elapsedAtEnd.get(s)! > windowStart) break;
              refDur += s.duration_seconds;
              refDist += s.distance_meters;
              refHrSum += s.avg_heart_rate * s.duration_seconds;
              if (refDur >= 1200) {
                const speedRatio = (totalDist / totalDur) / (refDist / refDur);
                const refEf = (refDist / refDur * 60) / (refHrSum / refDur);
                if (speedRatio >= 0.9 && speedRatio <= 1.1 && candidateEf < refEf * 0.962) accumulatedDrift = true;
                break;
              }
            }
          }
        }
        if (accumulatedDrift) continue;

        // Slower week protection: effort must reach the aerobic threshold stimulus band
        if (avgHr < stimulusFloorHr) continue;

        // Physiological sanity check against recent baseline:
        // Treat a single slowdown over 10% as insufficient evidence to replace a recent baseline.
        if (recentBaselinePace && avgPace > recentBaselinePace * 1.10) {
          continue;
        }

        // Select the highest steady aerobic effort that tests the aerobic ceiling.
        // If within 0.8 bpm, prefer the longer duration block.
        if (!bestBlock || avgHr > bestBlock.avgHr + 0.8 || (Math.abs(avgHr - bestBlock.avgHr) <= 0.8 && totalDur > bestBlock.durationSec)) {
          bestBlock = {
            startSplit: window[0].split_index,
            endSplit: window[window.length - 1].split_index,
            durationSec: totalDur,
            distMeters: totalDist,
            avgHr,
            avgPaceSecKm: avgPace,
            decouplingPct
          };
        }
      }
    }
  }

  return bestBlock;
}

export function evaluateThresholdUpdate(
  db: Database.Database,
  activityId: string,
  runDate: string,
  runType: RunType,
  metadata: ActivityMetadata,
  records: ActivityRecord[],
  economy: EconomyMetrics
): ThresholdEstimate {
  let estimatedLt1Hr: number | null = null;
  let estimatedLt1Pace: number | null = null;
  let estimatedLt2Hr: number | null = null;
  let estimatedLt2Pace: number | null = null;
  let lt1Confidence = 0.88;

  const profile = getAthleteHeartRateProfile(db);
  const { maxHr: effMax, restingHr: effRhr, lt2Hr: profileLt2Hr } = profile;
  const reserve = effMax - effRhr;
  let recentBaselineLt1Pace: number | null = null;
  let baselineLt1Hr = profile.lt1Hr;
  // Compare to a prior, recent calibration, never to this run's stale row or
  // a future calibration during chronological replay. Normalize mixed date formats.
  const priorValue: unknown = db.prepare(`SELECT lt1_hr, lt1_pace_sec_km FROM physiological_thresholds
    WHERE lt1_hr IS NOT NULL AND lt1_pace_sec_km IS NOT NULL
      AND julianday(effective_date) < julianday(?)
      AND julianday(effective_date) >= julianday(?, '-45 days')
    ORDER BY julianday(effective_date) DESC, id DESC LIMIT 1`).get(runDate, runDate);
  const prior = priorValue == null ? null : (() => {
    const row = dbRow(priorValue, 'physiological_thresholds');
    return { lt1_hr: dbNumber(row, 'lt1_hr', 'physiological_thresholds')!, lt1_pace_sec_km: dbNumber(row, 'lt1_pace_sec_km', 'physiological_thresholds')! };
  })();
  if (prior) {
    baselineLt1Hr = prior.lt1_hr;
    recentBaselineLt1Pace = prior.lt1_pace_sec_km;
  }
  // Low-drift easy running only measures LT1 if it actually approaches this
  // athlete's established ceiling. A recovery effort is not a new threshold.
  const stimulusFloorHr = baselineLt1Hr - Math.max(2, Math.round(reserve * 0.025));
  const minLt1Hr = Math.max(effRhr + 1, stimulusFloorHr);
  const maxLt1Hr = Math.min(profileLt2Hr - 2, baselineLt1Hr + Math.max(3, Math.round(reserve * 0.04)));
  let cruisingNote: string | null = null;

  if (profile.hasBaseline && (runType === 'easy_base' || runType === 'long_run')) {
    let splits: SplitRow[] = [];
    try {
      splits = db.prepare(`
        SELECT split_index, distance_meters, duration_seconds, avg_pace_sec_km, avg_heart_rate, elevation_change_m
        FROM activity_splits
        WHERE activity_id = ?
        ORDER BY split_index ASC
      `).all(activityId).map(value => {
        const row = dbRow(value, 'activity_splits');
        return {
          split_index: dbNumber(row, 'split_index', 'activity_splits')!,
          distance_meters: dbNumber(row, 'distance_meters', 'activity_splits')!,
          duration_seconds: dbNumber(row, 'duration_seconds', 'activity_splits')!,
          avg_pace_sec_km: dbNumber(row, 'avg_pace_sec_km', 'activity_splits')!,
          avg_heart_rate: dbNumber(row, 'avg_heart_rate', 'activity_splits')!,
          elevation_change_m: dbNumber(row, 'elevation_change_m', 'activity_splits', true) ?? undefined
        };
      });
    } catch { /* optional query: schema may predate this table */ }

    lt1Confidence = 0.88;
    if (splits.length >= 3) {
      const block = findAerobicCruisingBlock(splits, maxLt1Hr, stimulusFloorHr, recentBaselineLt1Pace);
      if (block) {
        estimatedLt1Hr = Math.min(maxLt1Hr, Math.max(minLt1Hr, Math.round(block.avgHr)));
        estimatedLt1Pace = Math.round(block.avgPaceSecKm);
        cruisingNote = `Cruising Block Km ${block.startSplit}-${block.endSplit} (${(block.durationSec / 60).toFixed(0)}m, Decoupling: ${block.decouplingPct.toFixed(1)}%)`;
        if (block.durationSec >= 2400 && Math.abs(block.decouplingPct) <= 2.0) {
          lt1Confidence = 0.92;
        } else if (block.durationSec >= 1800) {
          lt1Confidence = 0.90;
        } else {
          lt1Confidence = 0.86;
        }
      }
    } else {
      // Fallback for activities without split table (e.g. test suites or synthetic records)
      const totalDuration = metadata.totalDurationSeconds || economy.movingDurationSeconds || 0;
      const avgHr = economy.avgMovingHeartRate || 0;
      const avgPace = economy.avgMovingPaceSecKm || 0;
      const dec = economy.aerobicDecouplingPct;

      const isAerobicZone = avgHr >= stimulusFloorHr && avgHr <= maxLt1Hr;
      const isLt1Candidate =
        totalDuration >= 1500 && totalDuration <= 3600 &&
        dec !== null &&
        dec <= 3.8 &&
        dec >= -8.0 &&
        isAerobicZone;

      if (isLt1Candidate && avgHr && avgPace && (!recentBaselineLt1Pace || avgPace <= recentBaselineLt1Pace * 1.10)) {
        estimatedLt1Hr = Math.min(maxLt1Hr, Math.max(minLt1Hr, Math.round(avgHr)));
        estimatedLt1Pace = Math.round(avgPace);
        cruisingNote = `Steady aerobic run (${(totalDuration / 60).toFixed(0)}m, Decoupling: ${dec.toFixed(1)}%)`;
        if (totalDuration >= 2400 && Math.abs(dec) <= 2.0) {
          lt1Confidence = 0.92;
        } else if (totalDuration >= 1800) {
          lt1Confidence = 0.90;
        } else {
          lt1Confidence = 0.86;
        }
      }
    }
  }

  // Physiological pace validation:
  // 1. LT1 aerobic base pace cannot be faster than 120 sec/km (2:00/km) for human aerobic running.
  // 2. LT1 pace must always be slower than LT2 threshold pace.
  let knownLt2Pace: number | null = null;
  try {
    const lt2Value: unknown = db.prepare('SELECT lt2_pace_sec_km FROM physiological_thresholds WHERE lt2_pace_sec_km IS NOT NULL AND julianday(effective_date) < julianday(?) ORDER BY julianday(effective_date) DESC LIMIT 1').get(runDate);
    if (lt2Value != null) knownLt2Pace = dbNumber(dbRow(lt2Value, 'physiological_thresholds'), 'lt2_pace_sec_km', 'physiological_thresholds');
  } catch { /* optional query: schema may predate this table */ }

  if (estimatedLt1Pace !== null) {
    if (estimatedLt1Pace < 120 || (knownLt2Pace !== null && estimatedLt1Pace <= knownLt2Pace)) {
      estimatedLt1Pace = null;
      estimatedLt1Hr = null;
    }
  }
  const qualifiesLt1 = estimatedLt1Hr !== null && estimatedLt1Pace !== null;

  // 2. LT2 candidate: sustained threshold work. Race HR is not threshold HR;
  // a fixed pace multiplier cannot convert arbitrary race distances to LT2.
  // Applies acceleration ramp stripping (removes 10-12s standing start),
  // caps evaluation to first 30 mins of quality work to avoid tropical dehydration drift,
  // compensates for cardiac ramp lag, and scores confidence continuously based on rest continuity.
  let lt2Confidence = 0.85;
  if (profile.hasBaseline && runType === 'threshold_lt2') {
    let workInvs: Array<{ interval_index: number; start_seconds: number; duration_seconds: number; distance_meters: number | null; avg_heart_rate: number | null; avg_pace_sec_km: number | null }> = [];
    try {
      workInvs = db.prepare(
        "SELECT interval_index, start_seconds, duration_seconds, distance_meters, avg_heart_rate, avg_pace_sec_km FROM activity_intervals WHERE activity_id = ? AND type = 'work' ORDER BY interval_index ASC"
      ).all(activityId).map(value => {
        const row = dbRow(value, 'activity_intervals');
        return {
          interval_index: dbNumber(row, 'interval_index', 'activity_intervals')!,
          start_seconds: dbNumber(row, 'start_seconds', 'activity_intervals')!,
          duration_seconds: dbNumber(row, 'duration_seconds', 'activity_intervals')!,
          distance_meters: dbNumber(row, 'distance_meters', 'activity_intervals', true),
          avg_heart_rate: dbNumber(row, 'avg_heart_rate', 'activity_intervals', true),
          avg_pace_sec_km: dbNumber(row, 'avg_pace_sec_km', 'activity_intervals', true)
        };
      });
    } catch { /* optional query: schema may predate this table */ }

    // Screen effort against the independent athlete baseline, not the previous
    // inferred HR: otherwise one high-HR session raises the admission bar for
    // all later workouts and creates a self-reinforcing selection bias.
    const lt2EffortBaseline = getAthleteHeartRateProfile(db, false).lt2Hr;
    const stimulusFloor = lt2EffortBaseline - 10;
    // Sustained work, not strides or short VO2 reps. Count elapsed session
    // time as well as work time so a late long-run HR rise cannot qualify.
    const qualifiedWork = workInvs.filter(i => (i.avg_heart_rate ?? 0) >= stimulusFloor
      && i.duration_seconds >= 300 && i.start_seconds >= 0
      && i.start_seconds + i.duration_seconds <= 3600);

    if (qualifiedWork.length > 0) {
      let interRepRecs: Array<{ duration_seconds: number; hr_drop: number | null }> = [];
      if (workInvs.length >= 2) {
        try {
          const firstIdx = qualifiedWork[0].interval_index;
          const lastIdx = qualifiedWork[qualifiedWork.length - 1].interval_index;
          interRepRecs = db.prepare(
            "SELECT duration_seconds, hr_drop FROM activity_intervals WHERE activity_id = ? AND type = 'recovery' AND interval_index > ? AND interval_index < ? ORDER BY interval_index ASC"
          ).all(activityId, firstIdx, lastIdx).map(value => {
            const row = dbRow(value, 'activity_intervals');
            return { duration_seconds: dbNumber(row, 'duration_seconds', 'activity_intervals')!, hr_drop: dbNumber(row, 'hr_drop', 'activity_intervals', true) };
          });
        } catch { /* optional query: schema may predate this table */ }
      }

      const avgRestDur = interRepRecs.length > 0
        ? interRepRecs.reduce((s, i) => s + i.duration_seconds, 0) / interRepRecs.length
        : 0;
      const avgRestDrop = interRepRecs.length > 0
        ? interRepRecs.reduce((s, i) => s + (i.hr_drop || 0), 0) / interRepRecs.length
        : 0;

      // Evaluate at most 30 minutes of early quality work to limit drift exposure.
      const maxWorkEvalSec = 1800;
      let evalDur = 0;
      let evalDist = 0;
      let evalHrWeighted = 0;
      const workEfficiencies: number[] = [];
      let withinRepDrift = false;

      for (const inv of qualifiedWork) {
        if (evalDur >= maxWorkEvalSec) break;
        const durToTake = Math.min(inv.duration_seconds, maxWorkEvalSec - evalDur);
        const previousDistance = evalDist;
        const previousHrTime = evalHrWeighted;

        // Fetch records if available
        let repRecs: Array<{ elapsed_seconds: number; speed_mps: number | null; heart_rate: number | null }> = [];
        try {
          repRecs = db.prepare(
            "SELECT elapsed_seconds, speed_mps, heart_rate FROM activity_records WHERE activity_id = ? AND elapsed_seconds >= ? AND elapsed_seconds <= ? ORDER BY elapsed_seconds ASC"
          ).all(activityId, inv.start_seconds, inv.start_seconds + durToTake).map(value => {
            const row = dbRow(value, 'activity_records');
            return { elapsed_seconds: dbNumber(row, 'elapsed_seconds', 'activity_records')!, speed_mps: dbNumber(row, 'speed_mps', 'activity_records', true), heart_rate: dbNumber(row, 'heart_rate', 'activity_records', true) };
          });
        } catch { /* optional query: schema may predate this table */ }

        if (repRecs.length >= 30) {
          // 1. Pace: strip initial acceleration ramp if starting from walk/stop (< 2.2 m/s)
          const startsFromSlow = (repRecs[0]?.speed_mps ?? 0) < 2.2;
          const paceSkipSec = startsFromSlow ? Math.min(12, Math.floor(durToTake * 0.1)) : 0;
          const paceRecs = repRecs.filter(r => r.elapsed_seconds >= inv.start_seconds + paceSkipSec && r.speed_mps !== null && r.speed_mps > 1.5);
          const repAvgSpeed = paceRecs.length > 0
            ? paceRecs.reduce((s, r) => s + r.speed_mps!, 0) / paceRecs.length
            : ((inv.distance_meters ?? 0) / (inv.duration_seconds || 1));

          // 2. HR: strip initial cardiac lag (60-90s) if rep >= 300s
          const tRamp = inv.duration_seconds >= 300 ? Math.min(90, Math.max(45, Math.round(avgRestDrop * 1.5))) : 0;
          const hrRecs = repRecs.filter(r => r.elapsed_seconds >= inv.start_seconds + tRamp && r.heart_rate !== null && r.heart_rate > 100);
          // A single long rep can provide the entire calibration. Check its
          // internal efficiency decline too, after the cardiac ramp, using
          // elapsed-time weighting rather than the number of samples.
          const steadyStart = inv.start_seconds + Math.max(tRamp, paceSkipSec);
          const midpoint = (steadyStart + inv.start_seconds + durToTake) / 2;
          const halves = [{ distance: 0, beats: 0, duration: 0 }, { distance: 0, beats: 0, duration: 0 }];
          for (let r = 1; r < repRecs.length; r++) {
            const a = repRecs[r - 1], b = repRecs[r];
            if (b.elapsed_seconds - a.elapsed_seconds > 15 || b.heart_rate === null || b.speed_mps === null || b.heart_rate <= 40 || b.speed_mps <= 0) continue;
            for (let half = 0; half < 2; half++) {
              const from = Math.max(a.elapsed_seconds, half === 0 ? steadyStart : midpoint);
              const to = Math.min(b.elapsed_seconds, half === 0 ? midpoint : inv.start_seconds + durToTake);
              const dt = Math.max(0, to - from);
              halves[half].distance += b.speed_mps * dt;
              halves[half].beats += b.heart_rate * dt;
              halves[half].duration += dt;
            }
          }
          if (halves.every(h => h.duration >= 120 && h.beats > 0)) {
            const firstEf = halves[0].distance / halves[0].beats;
            const secondEf = halves[1].distance / halves[1].beats;
            if (secondEf < firstEf * 0.95) withinRepDrift = true;
          }
          const repAvgHr = hrRecs.length > 0
            ? hrRecs.reduce((s, r) => s + r.heart_rate!, 0) / hrRecs.length
            : (inv.avg_heart_rate ?? 0);

          evalDur += durToTake;
          evalDist += repAvgSpeed * durToTake;
          evalHrWeighted += repAvgHr * durToTake;
        } else {
          // Fallback when records are absent (e.g. tests or synthetic data)
          const hrComp = (avgRestDrop > 35 && inv.duration_seconds >= 300)
            ? Math.min(5, 0.5 * avgRestDrop * (Math.min(120, avgRestDrop * 1.8) / inv.duration_seconds))
            : 0;
          evalDur += durToTake;
          evalDist += (durToTake / (inv.duration_seconds || 1)) * (inv.distance_meters ?? 0);
          evalHrWeighted += ((inv.avg_heart_rate ?? 0) + hrComp) * durToTake;
        }
        if (durToTake >= 300) {
          workEfficiencies.push((evalDist - previousDistance) * 60 / (evalHrWeighted - previousHrTime));
        }
      }

      // A high-HR later repetition must not hide deterioration relative to
      // earlier work. Reject the session as calibration evidence if efficiency
      // falls over 5%, even when each repetition is locally steady.
      const accumulatedDrift = workEfficiencies.slice(1).some(ef => ef < workEfficiencies[0] * 0.95);
      if (evalDist > 0 && evalDur >= 1200 && !accumulatedDrift && !withinRepDrift) {
        const rawPace = Math.round((evalDur / evalDist) * 1000);
        estimatedLt2Pace = rawPace;
        estimatedLt2Hr = Math.round(evalHrWeighted / evalDur);

        // Continuous confidence based on rest continuity and protocol type
        {
          const avgWorkDur = evalDur / qualifiedWork.length;
          const excessRest = Math.max(0, avgRestDur - 60);
          const restPenalty = Math.min(0.14, (excessRest / (avgWorkDur || 900)) * 0.45);
          lt2Confidence = Number((0.92 - restPenalty).toFixed(2));
        }
      }
    }

    // Fallback when no usable work intervals exist yet (e.g. continuous tempo
    // classified threshold via zone occupancy).
    // Skipped when work intervals exist but never reached the stimulus band.
    // (profile-relative HR floor, no speed gate so slower athletes qualify equally).
    if (!estimatedLt2Pace && workInvs.length === 0) {
      const lt2Floor = lt2EffortBaseline - 5;
      // Find continuous evidence, never stitch isolated high-HR samples across
      // recoveries. Without records, a whole-run average cannot establish LT2.
      let highRecords: ActivityRecord[] = [];
      let candidate: ActivityRecord[] = [];
      for (const record of [...records].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)) {
        const previous = candidate[candidate.length - 1];
        const gap = previous ? record.elapsedSeconds - previous.elapsedSeconds : 0;
        if (record.elapsedSeconds > 3600 || !record.heartRate || record.heartRate < lt2Floor || !record.speedMps || record.speedMps <= 0 || gap > 5 || gap < 0) {
          candidate = [];
        }
        if (record.elapsedSeconds <= 3600 && record.heartRate && record.heartRate >= lt2Floor && record.speedMps && record.speedMps > 0) {
          candidate.push(record);
          const duration = record.elapsedSeconds - candidate[0].elapsedSeconds;
          if (duration >= 1200) { highRecords = candidate; break; }
        }
      }
      if (highRecords.length > 1) {
        let duration = 0, distance = 0, hrTime = 0;
        let firstDistance = 0, firstHrTime = 0;
        const midpoint = (highRecords[0].elapsedSeconds + highRecords[highRecords.length - 1].elapsedSeconds) / 2;
        for (let i = 1; i < highRecords.length; i++) {
          const dt = highRecords[i].elapsedSeconds - highRecords[i - 1].elapsedSeconds;
          duration += dt;
          distance += (highRecords[i].speedMps || 0) * dt;
          hrTime += (highRecords[i].heartRate || 0) * dt;
          const firstDt = Math.max(0, Math.min(highRecords[i].elapsedSeconds, midpoint) - highRecords[i - 1].elapsedSeconds);
          firstDistance += (highRecords[i].speedMps || 0) * firstDt;
          firstHrTime += (highRecords[i].heartRate || 0) * firstDt;
        }
        const avgSpd = distance / duration;
        const segmentPace = Math.round(1000 / avgSpd);
        const firstEf = firstDistance / firstHrTime;
        const secondEf = (distance - firstDistance) / (hrTime - firstHrTime);
        if (Number.isFinite(segmentPace) && secondEf >= firstEf * 0.95) {
          estimatedLt2Pace = segmentPace;
          estimatedLt2Hr = Math.round(hrTime / duration);
        }
      }
    }
  }

  // 3. Compute 30-day rolling baseline economy
  const past30DaysQuery = db.prepare(`
    SELECT AVG(efficiency_factor) as avg_ef
    FROM activities
    WHERE efficiency_factor IS NOT NULL
      AND start_time >= datetime(?, '-30 days')
      AND start_time <= datetime(?)
  `);
  const rowValue: unknown = past30DaysQuery.get(runDate, runDate);
  const avgEf = rowValue == null ? null : dbNumber(dbRow(rowValue, 'activities aggregate'), 'avg_ef', 'activities aggregate', true);
  const baselineEconomyEf = avgEf ? Number(avgEf.toFixed(4)) : economy.efficiencyFactor;

  // 4. Save to physiological_thresholds if new candidate detected
  const isLt2Candidate = runType === 'threshold_lt2' && estimatedLt2Pace !== null;
  if (qualifiesLt1 || isLt2Candidate) {
    db.prepare('DELETE FROM physiological_thresholds WHERE source_activity_id = ?').run(activityId);

    const insertThreshold = db.prepare(`
      INSERT INTO physiological_thresholds (
        effective_date,
        source_activity_id,
        lt1_hr,
        lt1_pace_sec_km,
        lt2_hr,
        lt2_pace_sec_km,
        baseline_economy_ef,
        confidence,
        notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let note = 'Threshold calibration update';
    if (qualifiesLt1 && isLt2Candidate) {
      note = `Calibrated dual LT1/LT2 baseline (${cruisingNote || (economy.aerobicDecouplingPct !== null ? `Decoupling: ${economy.aerobicDecouplingPct.toFixed(1)}%` : 'steady')})`;
    } else if (qualifiesLt1) {
      note = `Calibrated Aerobic Base (LT1) from ${cruisingNote || 'steady aerobic cruising block'}`;
    } else {
      note = `Calibrated Lactate Threshold (LT2) from sustained early threshold work`;
    }

    const confidenceToSave = qualifiesLt1 && isLt2Candidate
      ? Number(((lt1Confidence + lt2Confidence) / 2).toFixed(2))
      : (qualifiesLt1 ? lt1Confidence : lt2Confidence);

    insertThreshold.run(
      runDate,
      activityId,
      estimatedLt1Hr,
      estimatedLt1Pace,
      estimatedLt2Hr,
      estimatedLt2Pace,
      baselineEconomyEf,
      confidenceToSave,
      note
    );

    // Continuously update athlete_profile with the rolling smoothed thresholds
    try {
      const rolling = computeRollingThresholds(db, runDate);
      const updates: string[] = [];
      const params: Array<string | number> = [];
      if (rolling.lt1Hr) {
        updates.push('lt1_hr = ?');
        params.push(rolling.lt1Hr);
        // Preserve an explicitly configured working range when present. The
        // range is intentionally steadier than the rolling point estimate.
        const range = profileRange(db.prepare("SELECT lt1_min_hr, lt1_max_hr FROM athlete_profile WHERE id = 'primary'").get());
        const minHr = range?.lt1_min_hr ?? rolling.lt1Hr - 1;
        const maxHr = range?.lt1_max_hr ?? rolling.lt1Hr + 1;
        updates.push('z3_start_hr = ?');
        params.push(maxHr + 1);
        updates.push('lt1_min_hr = ?');
        params.push(minHr);
        updates.push('lt1_max_hr = ?');
        params.push(maxHr);
      }
      if (rolling.lt2Hr) {
        updates.push('lt2_hr = ?');
        params.push(rolling.lt2Hr);
        updates.push('z4_start_hr = ?');
        params.push(rolling.lt2Hr);
      }
      if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push('primary');
        db.prepare(`UPDATE athlete_profile SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      }
    } catch {
      // Non-fatal if table not created yet
    }
  } else {
    try {
      db.prepare('DELETE FROM physiological_thresholds WHERE source_activity_id = ?').run(activityId);
    } catch { /* optional query: schema may predate this table */ }
  }

  return {
    lt1Hr: estimatedLt1Hr,
    lt1PaceSecKm: estimatedLt1Pace,
    lt2Hr: estimatedLt2Hr,
    lt2PaceSecKm: estimatedLt2Pace,
    baselineEconomyEf
  };
}

export function computeRollingThresholds(
  db: Database.Database,
  asOfDate?: string
): {
  lt1Hr: number | null;
  lt1PaceSecKm: number | null;
  lt1Confidence: number;
  lt2Hr: number | null;
  lt2PaceSecKm: number | null;
  lt2Confidence: number;
  lastLt1Date: string | null;
  lastLt2Date: string | null;
} {
  const refDateStr = asOfDate || new Date().toISOString();
  // 1. Fetch recent LT1 calibrations (up to 5 in last 45 days, or last 3 if none in 45 days)
  let lt1Rows: ThresholdObservation[] = [];
  try {
    lt1Rows = thresholdObservations(db.prepare(`
      SELECT lt1_hr as hr, lt1_pace_sec_km as pace, confidence, effective_date
      FROM physiological_thresholds
      WHERE lt1_hr IS NOT NULL
        AND julianday(effective_date) <= julianday(?)
        AND julianday(effective_date) >= julianday(?, '-45 days')
      ORDER BY julianday(effective_date) DESC, id DESC
      LIMIT 5
    `).all(refDateStr, refDateStr), 'physiological_thresholds');

    if (lt1Rows.length === 0) {
      lt1Rows = thresholdObservations(db.prepare(`
        SELECT lt1_hr as hr, lt1_pace_sec_km as pace, confidence, effective_date
        FROM physiological_thresholds
        WHERE lt1_hr IS NOT NULL
          AND julianday(effective_date) <= julianday(?)
        ORDER BY julianday(effective_date) DESC, id DESC
        LIMIT 3
      `).all(refDateStr), 'physiological_thresholds');
    }
  } catch { /* optional query: schema may predate this table */ }

  // 2. Fetch recent LT2 calibrations (up to 5 in last 45 days, or last 3 if none in 45 days)
  let lt2Rows: ThresholdObservation[] = [];
  try {
    lt2Rows = thresholdObservations(db.prepare(`
      SELECT lt2_hr as hr, lt2_pace_sec_km as pace, confidence, effective_date
      FROM physiological_thresholds
      WHERE lt2_hr IS NOT NULL
        AND julianday(effective_date) <= julianday(?)
        AND julianday(effective_date) >= julianday(?, '-45 days')
      ORDER BY julianday(effective_date) DESC, id DESC
      LIMIT 5
    `).all(refDateStr, refDateStr), 'physiological_thresholds');

    if (lt2Rows.length === 0) {
      lt2Rows = thresholdObservations(db.prepare(`
        SELECT lt2_hr as hr, lt2_pace_sec_km as pace, confidence, effective_date
        FROM physiological_thresholds
        WHERE lt2_hr IS NOT NULL
          AND julianday(effective_date) <= julianday(?)
        ORDER BY julianday(effective_date) DESC, id DESC
        LIMIT 3
      `).all(refDateStr), 'physiological_thresholds');
    }
  } catch { /* optional query: schema may predate this table */ }

  const rolledLt1 = rollingThreshold(lt1Rows, refDateStr);
  const rolledLt2 = rollingThreshold(lt2Rows, refDateStr);

  return {
    lt1Hr: rolledLt1?.hr ?? null,
    lt1PaceSecKm: rolledLt1?.pace ?? null,
    lt1Confidence: rolledLt1?.confidence ?? 0.85,
    lt2Hr: rolledLt2?.hr ?? null,
    lt2PaceSecKm: rolledLt2?.pace ?? null,
    lt2Confidence: rolledLt2?.confidence ?? 0.85,
    lastLt1Date: rolledLt1?.latestDate ?? null,
    lastLt2Date: rolledLt2?.latestDate ?? null
  };
}

/**
 * Latest calibrated running-economy baseline (metres per heart beat).
 * Mirrors the "Efficiency Factor" tile shown in Progress & Stats so the Profile
 * tab never renders an empty EF value once a calibration exists.
 */
export function getLatestBaselineEconomyEf(db: Database.Database): number | null {
  try {
    const lt1Value: unknown = db.prepare(`
      SELECT baseline_economy_ef
      FROM physiological_thresholds
      WHERE baseline_economy_ef IS NOT NULL AND lt1_hr IS NOT NULL
      ORDER BY effective_date DESC, id DESC
      LIMIT 1
    `).get();
    const lt1Ef = lt1Value == null ? null : dbNumber(dbRow(lt1Value, 'physiological_thresholds'), 'baseline_economy_ef', 'physiological_thresholds', true);

    if (lt1Ef != null) {
      return lt1Ef;
    }

    const anyValue: unknown = db.prepare(`
      SELECT baseline_economy_ef
      FROM physiological_thresholds
      WHERE baseline_economy_ef IS NOT NULL
      ORDER BY effective_date DESC, id DESC
      LIMIT 1
    `).get();
    const anyEf = anyValue == null ? null : dbNumber(dbRow(anyValue, 'physiological_thresholds'), 'baseline_economy_ef', 'physiological_thresholds', true);

    return anyEf;
  } catch {
    return null;
  }
}

export function getCurrentThresholds(db: Database.Database): {
  lt1Hr: number;
  lt2Hr: number;
  lt1Range: [number, number];
  lt1PaceSecKm: number | null;
  lt2PaceSecKm: number | null;
  baselineEconomyEf: number | null;
  confidence: number;
  source: 'calibrated' | 'baseline';
  lastCalibratedDate: string | null;
} {
  try {
    const profile = getAthleteHeartRateProfile(db);
    const profileRangeRow = profileRange(db.prepare("SELECT lt1_min_hr, lt1_max_hr FROM athlete_profile WHERE id = 'primary'").get());
    const rolling = computeRollingThresholds(db);
    const { lt1Hr, lt2Hr } = resolveHeartRateProfile({ ...profile,
      lt1Hr: rolling.lt1Hr ?? profile.lt1Hr, lt2Hr: rolling.lt2Hr ?? profile.lt2Hr });

    const hasCalibration = rolling.lt1Hr !== null || rolling.lt2Hr !== null;
    const conf = hasCalibration
      ? Number((((rolling.lt1Hr ? rolling.lt1Confidence : 0) + (rolling.lt2Hr ? rolling.lt2Confidence : 0)) / ((rolling.lt1Hr ? 1 : 0) + (rolling.lt2Hr ? 1 : 0) || 1)).toFixed(2))
      : 0.5;

    const latestDate = rolling.lastLt2Date || rolling.lastLt1Date || null;
    const storedRange = profileRangeRow?.lt1_min_hr != null && profileRangeRow?.lt1_max_hr != null
      && profileRangeRow.lt1_min_hr <= profileRangeRow.lt1_max_hr
      ? [profileRangeRow.lt1_min_hr, profileRangeRow.lt1_max_hr] as [number, number]
      : [lt1Hr - 1, lt1Hr + 1] as [number, number];

    return {
      lt1Hr,
      lt2Hr,
      lt1Range: storedRange,
      lt1PaceSecKm: rolling.lt1PaceSecKm,
      lt2PaceSecKm: rolling.lt2PaceSecKm,
      baselineEconomyEf: getLatestBaselineEconomyEf(db),
      confidence: conf,
      source: hasCalibration ? 'calibrated' : 'baseline',
      lastCalibratedDate: latestDate
    };
  } catch {
    const fallback = getAthleteHeartRateProfile(db);
    return {
      lt1Hr: fallback.lt1Hr,
      lt2Hr: fallback.lt2Hr,
      lt1Range: [fallback.lt1Hr - 1, fallback.lt1Hr + 1],
      lt1PaceSecKm: null,
      lt2PaceSecKm: null,
      baselineEconomyEf: getLatestBaselineEconomyEf(db),
      confidence: 0.5,
      source: 'baseline',
      lastCalibratedDate: null
    };
  }
}
