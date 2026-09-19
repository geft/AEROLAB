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

export function findAerobicCruisingBlock(
  splits: SplitRow[],
  maxLt1Hr: number,
  stimulusFloorHr: number,
  recentBaselinePace?: number | null
): CruisingBlock | null {
  const isCandidateSplit = (s: SplitRow) =>
    s.distance_meters >= 700 &&
    s.avg_pace_sec_km >= 200 &&
    s.avg_pace_sec_km <= 480 &&
    s.avg_heart_rate > 100 &&
    Math.abs(s.elevation_change_m ?? 0) < 30;

  if (splits.length < 3) return null;

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

        const totalDur = window.reduce((acc, s) => acc + s.duration_seconds, 0);
        const totalDist = window.reduce((acc, s) => acc + s.distance_meters, 0);

        // Require minimum 20 minutes (1200 seconds) or >= 3.5 km of continuous steady aerobic running
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

        // Steady aerobic run: decoupling between -8.0% and 4.2%
        if (decouplingPct > 4.2 || decouplingPct < -8.0) continue;

        // Slower week protection: effort must reach the aerobic threshold stimulus band
        if (avgHr < stimulusFloorHr) continue;

        // Physiological sanity check against recent baseline:
        // True aerobic threshold pace cannot suddenly collapse by > 50s/km in uninjured athletes
        if (recentBaselinePace && avgPace > recentBaselinePace + 50) {
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

  // Retrieve athlete profile for baseline reference (profile-relative, no hardcoded bpm)
  let baselineLt1Hr: number | null = null;
  let profileLt2Hr: number | null = null;
  let profileMaxHr: number | null = null;
  let profileRestingHr: number | null = null;
  try {
    const prof = db.prepare('SELECT lt1_hr, lt2_hr, max_hr, resting_hr, age FROM athlete_profile WHERE id = ?').get('primary') as any;
    if (prof?.lt1_hr) baselineLt1Hr = prof.lt1_hr;
    if (prof?.lt2_hr) profileLt2Hr = prof.lt2_hr;
    if (prof?.max_hr) profileMaxHr = prof.max_hr;
    if (prof?.resting_hr) profileRestingHr = prof.resting_hr;
  } catch {}

  const effMax = profileMaxHr || 203;
  const effRhr = profileRestingHr || 54;
  // LT1 (aerobic threshold) is ~65% HRR (Karvonen), typical range 145-152 bpm
  const targetLt1 = Math.min(152, Math.max(145, Math.round(effRhr + (effMax - effRhr) * 0.65)));
  const minLt1Hr = Math.max(135, targetLt1 - 10);
  const maxLt1Hr = Math.min(155, targetLt1 + 6);

  // Sanitize baselineLt1Hr so it can never be poisoned above maxLt1Hr
  if (!baselineLt1Hr || baselineLt1Hr > maxLt1Hr || baselineLt1Hr < minLt1Hr) {
    baselineLt1Hr = Math.min(maxLt1Hr, Math.max(minLt1Hr, 148));
  }

  // 1. LT1 Candidate: Sustained Steady Aerobic Cruising Block with low decoupling
  // Slower week protection: effort must reach the aerobic threshold stimulus band.
  // Light recovery or sub-LT1 jogs (e.g. 125-135 bpm) do not touch the aerobic ceiling and MUST NOT calibrate LT1.
  let cruisingNote: string | null = null;
  const stimulusFloorHr = Math.max(142, (baselineLt1Hr ?? targetLt1) - 8);

  // Retrieve recent baseline LT1 pace as an outlier protection anchor
  let recentBaselineLt1Pace: number | null = null;
  try {
    const recentRow = db.prepare(`
      SELECT lt1_pace_sec_km
      FROM physiological_thresholds
      WHERE lt1_pace_sec_km IS NOT NULL AND effective_date < ?
      ORDER BY effective_date DESC LIMIT 1
    `).get(runDate) as any;
    if (recentRow?.lt1_pace_sec_km) recentBaselineLt1Pace = recentRow.lt1_pace_sec_km;
  } catch {}

  if (runType === 'easy_base' || runType === 'long_run') {
    let splits: SplitRow[] = [];
    try {
      splits = db.prepare(`
        SELECT split_index, distance_meters, duration_seconds, avg_pace_sec_km, avg_heart_rate, elevation_change_m
        FROM activity_splits
        WHERE activity_id = ?
        ORDER BY split_index ASC
      `).all(activityId) as SplitRow[];
    } catch {}

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
        totalDuration >= 1500 &&
        dec !== null &&
        dec <= 3.8 &&
        dec >= -8.0 &&
        isAerobicZone;

      if (isLt1Candidate && avgHr && avgPace) {
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
  // 1. LT1 aerobic base pace cannot be faster than 200 sec/km (3:20/km) for human aerobic running.
  // 2. LT1 pace must always be slower than LT2 threshold pace.
  let knownLt2Pace: number | null = null;
  try {
    const lt2Row = db.prepare('SELECT lt2_pace_sec_km FROM physiological_thresholds WHERE lt2_pace_sec_km IS NOT NULL ORDER BY effective_date DESC LIMIT 1').get() as any;
    if (lt2Row?.lt2_pace_sec_km) knownLt2Pace = lt2Row.lt2_pace_sec_km;
  } catch {}

  if (estimatedLt1Pace !== null) {
    if (estimatedLt1Pace < 200 || (knownLt2Pace !== null && estimatedLt1Pace <= knownLt2Pace + 15)) {
      estimatedLt1Pace = null;
      estimatedLt1Hr = null;
    }
  }
  const qualifiesLt1 = estimatedLt1Hr !== null && estimatedLt1Pace !== null;

  // 2. LT2 Candidate: Threshold run, quality intervals, or continuous race effort.
  // Applies acceleration ramp stripping (removes 10-12s standing start),
  // caps evaluation to first 30 mins of quality work to avoid tropical dehydration drift,
  // compensates for cardiac ramp lag, and scores confidence continuously based on rest continuity.
  let lt2Confidence = 0.85;
  if (runType === 'threshold_lt2' || runType === 'race') {
    let workInvs: any[] = [];
    try {
      workInvs = db.prepare(
        "SELECT interval_index, start_seconds, duration_seconds, distance_meters, avg_heart_rate, avg_pace_sec_km FROM activity_intervals WHERE activity_id = ? AND type = 'work' ORDER BY interval_index ASC"
      ).all(activityId) as any[];
    } catch {}

    const stimulusFloor = (profileLt2Hr ?? 167) - 10;
    const qualifiedWork = workInvs.filter(i => (i.avg_heart_rate ?? 0) >= stimulusFloor);

    if (qualifiedWork.length > 0) {
      let interRepRecs: any[] = [];
      if (workInvs.length >= 2) {
        try {
          const firstIdx = workInvs[0].interval_index;
          const lastIdx = workInvs[workInvs.length - 1].interval_index;
          interRepRecs = db.prepare(
            "SELECT duration_seconds, hr_drop FROM activity_intervals WHERE activity_id = ? AND type = 'recovery' AND interval_index > ? AND interval_index < ? ORDER BY interval_index ASC"
          ).all(activityId, firstIdx, lastIdx) as any[];
        } catch {}
      }

      const avgRestDur = interRepRecs.length > 0
        ? interRepRecs.reduce((s, i) => s + i.duration_seconds, 0) / interRepRecs.length
        : 0;
      const avgRestDrop = interRepRecs.length > 0
        ? interRepRecs.reduce((s, i) => s + (i.hr_drop || 0), 0) / interRepRecs.length
        : 0;

      // Tropical window: evaluate up to first 30 minutes (1800s) of quality work
      // to eliminate late-session hyperthermia and dehydration drift
      const maxWorkEvalSec = 1800;
      let evalDur = 0;
      let evalDist = 0;
      let evalHrWeighted = 0;

      for (const inv of qualifiedWork) {
        if (evalDur >= maxWorkEvalSec) break;
        const durToTake = Math.min(inv.duration_seconds, maxWorkEvalSec - evalDur);

        // Fetch records if available
        let repRecs: any[] = [];
        try {
          repRecs = db.prepare(
            "SELECT elapsed_seconds, speed_mps, heart_rate FROM activity_records WHERE activity_id = ? AND elapsed_seconds >= ? AND elapsed_seconds <= ? ORDER BY elapsed_seconds ASC"
          ).all(activityId, inv.start_seconds, inv.start_seconds + durToTake) as any[];
        } catch {}

        if (repRecs.length >= 30) {
          // 1. Pace: strip initial acceleration ramp if starting from walk/stop (< 2.2 m/s)
          const startsFromSlow = (repRecs[0]?.speed_mps ?? 0) < 2.2;
          const paceSkipSec = startsFromSlow ? Math.min(12, Math.floor(durToTake * 0.1)) : 0;
          const paceRecs = repRecs.filter(r => r.elapsed_seconds >= inv.start_seconds + paceSkipSec && r.speed_mps > 1.5);
          const repAvgSpeed = paceRecs.length > 0
            ? paceRecs.reduce((s, r) => s + r.speed_mps, 0) / paceRecs.length
            : (inv.distance_meters / (inv.duration_seconds || 1));

          // 2. HR: strip initial cardiac lag (60-90s) if rep >= 300s
          const tRamp = inv.duration_seconds >= 300 ? Math.min(90, Math.max(45, Math.round(avgRestDrop * 1.5))) : 0;
          const hrRecs = repRecs.filter(r => r.elapsed_seconds >= inv.start_seconds + tRamp && r.heart_rate > 100);
          const repAvgHr = hrRecs.length > 0
            ? hrRecs.reduce((s, r) => s + r.heart_rate, 0) / hrRecs.length
            : inv.avg_heart_rate;

          evalDur += durToTake;
          evalDist += repAvgSpeed * durToTake;
          evalHrWeighted += repAvgHr * durToTake;
        } else {
          // Fallback when records are absent (e.g. tests or synthetic data)
          const hrComp = (avgRestDrop > 35 && inv.duration_seconds >= 300)
            ? Math.min(5, 0.5 * avgRestDrop * (Math.min(120, avgRestDrop * 1.8) / inv.duration_seconds))
            : 0;
          evalDur += durToTake;
          evalDist += (durToTake / (inv.duration_seconds || 1)) * inv.distance_meters;
          evalHrWeighted += (inv.avg_heart_rate + hrComp) * durToTake;
        }
      }

      if (evalDist > 0 && evalDur > 0) {
        const rawPace = Math.round((evalDur / evalDist) * 1000);
        estimatedLt2Pace = runType === 'race' ? Math.round(rawPace * 1.045) : rawPace;
        estimatedLt2Hr = Math.round(evalHrWeighted / evalDur);

        // Continuous confidence based on rest continuity and protocol type
        if (runType === 'race') {
          lt2Confidence = 0.95;
        } else {
          const avgWorkDur = evalDur / qualifiedWork.length;
          const excessRest = Math.max(0, avgRestDur - 60);
          const restPenalty = Math.min(0.14, (excessRest / (avgWorkDur || 900)) * 0.45);
          lt2Confidence = Number((0.92 - restPenalty).toFixed(2));
        }
      }
    }

    // Fallback when no usable work intervals exist yet (e.g. continuous tempo
    // classified threshold via zone occupancy, or a race without splits).
    // Skipped when work intervals exist but never reached the stimulus band.
    // (profile-relative HR floor, no speed gate so slower athletes qualify equally).
    if (!estimatedLt2Pace && workInvs.length === 0) {
      const lt2Floor = (profileLt2Hr ?? 167) - 5;
      const highRecords = records.filter(r => r.heartRate && r.heartRate >= lt2Floor);
      if (highRecords.length >= 300) {
        const avgSpd = highRecords.reduce((s, r) => s + (r.speedMps || 0), 0) / highRecords.length;
        const segmentPace = Math.round(1000 / avgSpd);
        estimatedLt2Pace = runType === 'race' ? Math.round(segmentPace * 1.045) : segmentPace;
        estimatedLt2Hr = Math.round(highRecords.reduce((s, r) => s + (r.heartRate || 0), 0) / highRecords.length);
      } else if (economy.avgMovingHeartRate && economy.avgMovingPaceSecKm) {
        estimatedLt2Hr = economy.avgMovingHeartRate;
        estimatedLt2Pace = Math.round(economy.avgMovingPaceSecKm);
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
  const row = past30DaysQuery.get(runDate, runDate) as { avg_ef: number | null } | undefined;
  const baselineEconomyEf = row?.avg_ef ? Number(row.avg_ef.toFixed(4)) : economy.efficiencyFactor;

  // 4. Save to physiological_thresholds if new candidate detected
  const isLt2Candidate = (runType === 'threshold_lt2' || runType === 'race') && estimatedLt2Pace !== null;
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
    } else if (runType === 'race') {
      note = `Calibrated Lactate Threshold (LT2) from all-out 5K race pace`;
    } else {
      note = `Calibrated Lactate Threshold (LT2) from structured quality intervals`;
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
      const params: any[] = [];
      if (rolling.lt1Hr) {
        updates.push('lt1_hr = ?');
        params.push(rolling.lt1Hr);
        updates.push('z3_start_hr = ?');
        params.push(rolling.lt1Hr + 1);
        updates.push('lt1_min_hr = ?');
        params.push(rolling.lt1Hr - 1);
        updates.push('lt1_max_hr = ?');
        params.push(rolling.lt1Hr + 1);
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
    } catch {}
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
  const refTimeMs = new Date(refDateStr.replace(' ', 'T')).getTime() || Date.now();

  const computeWeighted = (
    rows: Array<{ hr: number; pace: number | null; confidence: number; effective_date: string }>
  ) => {
    if (!rows || rows.length === 0) return null;

    let totalWeight = 0;
    let weightedHrSum = 0;
    let totalPaceWeight = 0;
    let weightedPaceSum = 0;
    let weightedConfSum = 0;

    for (const r of rows) {
      const rowTimeMs = new Date(r.effective_date.replace(' ', 'T')).getTime() || refTimeMs;
      const daysAgo = Math.max(0, (refTimeMs - rowTimeMs) / (24 * 3600 * 1000));
      // Recency factor decays over 45 days down to floor of 0.25
      const recencyFactor = Math.max(0.25, 1 - (daysAgo / 45));
      const weight = (r.confidence || 0.85) * recencyFactor;

      totalWeight += weight;
      weightedHrSum += r.hr * weight;
      weightedConfSum += (r.confidence || 0.85) * weight;

      if (r.pace && r.pace > 0) {
        totalPaceWeight += weight;
        weightedPaceSum += r.pace * weight;
      }
    }

    if (totalWeight <= 0) return null;

    return {
      hr: Math.round(weightedHrSum / totalWeight),
      pace: totalPaceWeight > 0 ? Math.round(weightedPaceSum / totalPaceWeight) : null,
      confidence: Number((weightedConfSum / totalWeight).toFixed(2)),
      latestDate: rows[0].effective_date
    };
  };

  // 1. Fetch recent LT1 calibrations (up to 5 in last 45 days, or last 3 if none in 45 days)
  let lt1Rows: any[] = [];
  try {
    lt1Rows = db.prepare(`
      SELECT lt1_hr as hr, lt1_pace_sec_km as pace, confidence, effective_date
      FROM physiological_thresholds
      WHERE lt1_hr IS NOT NULL
        AND effective_date <= ?
        AND effective_date >= datetime(?, '-45 days')
      ORDER BY effective_date DESC, id DESC
      LIMIT 5
    `).all(refDateStr, refDateStr) as any[];

    if (lt1Rows.length === 0) {
      lt1Rows = db.prepare(`
        SELECT lt1_hr as hr, lt1_pace_sec_km as pace, confidence, effective_date
        FROM physiological_thresholds
        WHERE lt1_hr IS NOT NULL
          AND effective_date <= ?
        ORDER BY effective_date DESC, id DESC
        LIMIT 3
      `).all(refDateStr) as any[];
    }
  } catch {}

  // 2. Fetch recent LT2 calibrations (up to 5 in last 45 days, or last 3 if none in 45 days)
  let lt2Rows: any[] = [];
  try {
    lt2Rows = db.prepare(`
      SELECT lt2_hr as hr, lt2_pace_sec_km as pace, confidence, effective_date
      FROM physiological_thresholds
      WHERE lt2_hr IS NOT NULL
        AND effective_date <= ?
        AND effective_date >= datetime(?, '-45 days')
      ORDER BY effective_date DESC, id DESC
      LIMIT 5
    `).all(refDateStr, refDateStr) as any[];

    if (lt2Rows.length === 0) {
      lt2Rows = db.prepare(`
        SELECT lt2_hr as hr, lt2_pace_sec_km as pace, confidence, effective_date
        FROM physiological_thresholds
        WHERE lt2_hr IS NOT NULL
          AND effective_date <= ?
        ORDER BY effective_date DESC, id DESC
        LIMIT 3
      `).all(refDateStr) as any[];
    }
  } catch {}

  const rolledLt1 = computeWeighted(lt1Rows);
  const rolledLt2 = computeWeighted(lt2Rows);

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

export function getCurrentThresholds(db: Database.Database): {
  lt1Hr: number;
  lt2Hr: number;
  lt1Range: [number, number];
  lt1PaceSecKm: number | null;
  lt2PaceSecKm: number | null;
  confidence: number;
  source: 'calibrated' | 'baseline';
  lastCalibratedDate: string | null;
} {
  try {
    const profile = db.prepare('SELECT lt1_hr, lt2_hr, max_hr, resting_hr, age FROM athlete_profile WHERE id = ?').get('primary') as any;
    const effMax = profile?.max_hr || (profile?.age ? Math.round(208 - 0.7 * profile.age) : 203);
    const effRhr = profile?.resting_hr || 54;
    const fallbackLt1 = Math.min(152, Math.max(145, Math.round(effRhr + (effMax - effRhr) * 0.65))); // ~148-151 bpm
    const fallbackLt2 = Math.round(effRhr + (effMax - effRhr) * 0.82); // ~176 bpm

    const maxPlausibleLt1 = Math.min(155, fallbackLt2 - 18);
    const minPlausibleLt1 = Math.max(135, fallbackLt1 - 12);

    const rolling = computeRollingThresholds(db);

    let lt1Hr = rolling.lt1Hr || profile?.lt1_hr || fallbackLt1;
    if (lt1Hr > maxPlausibleLt1 || lt1Hr < minPlausibleLt1) {
      lt1Hr = fallbackLt1;
    }
    const lt2Hr = rolling.lt2Hr || profile?.lt2_hr || fallbackLt2;

    const hasCalibration = rolling.lt1Hr !== null || rolling.lt2Hr !== null;
    const conf = hasCalibration
      ? Number((((rolling.lt1Hr ? rolling.lt1Confidence : 0) + (rolling.lt2Hr ? rolling.lt2Confidence : 0)) / ((rolling.lt1Hr ? 1 : 0) + (rolling.lt2Hr ? 1 : 0) || 1)).toFixed(2))
      : 1.0;

    const latestDate = rolling.lastLt2Date || rolling.lastLt1Date || null;

    return {
      lt1Hr,
      lt2Hr,
      lt1Range: [lt1Hr - 1, lt1Hr + 1],
      lt1PaceSecKm: rolling.lt1PaceSecKm,
      lt2PaceSecKm: rolling.lt2PaceSecKm,
      confidence: conf,
      source: hasCalibration ? 'calibrated' : 'baseline',
      lastCalibratedDate: latestDate
    };
  } catch {
    return {
      lt1Hr: 148,
      lt2Hr: 167,
      lt1Range: [147, 149],
      lt1PaceSecKm: null,
      lt2PaceSecKm: null,
      confidence: 1.0,
      source: 'baseline',
      lastCalibratedDate: null
    };
  }
}

