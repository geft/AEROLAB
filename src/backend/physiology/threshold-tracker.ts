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

  // 1. LT1 Candidate: Steady Base Run with low decoupling (< 4.5%)
  const totalDuration = metadata.totalDurationSeconds || economy.movingDurationSeconds || 0;
  const isLt1Candidate =
    (runType === 'easy_base' || runType === 'long_run') &&
    economy.aerobicDecouplingPct !== null &&
    economy.aerobicDecouplingPct < 4.5 &&
    totalDuration >= 1500; // at least 25 mins

  if (isLt1Candidate && economy.avgMovingHeartRate && economy.avgMovingPaceSecKm) {
    estimatedLt1Hr = Math.round(economy.avgMovingHeartRate);
    estimatedLt1Pace = Math.round(economy.avgMovingPaceSecKm);
  }

  // 2. LT2 Candidate: Threshold run, quality intervals, or continuous race effort
  if (runType === 'threshold_lt2' || runType === 'race') {
    const workInvs = db.prepare(
      "SELECT duration_seconds, distance_meters, avg_heart_rate, avg_pace_sec_km FROM activity_intervals WHERE activity_id = ? AND type = 'work'"
    ).all(activityId) as any[];

    if (workInvs.length > 0) {
      const totalDur = workInvs.reduce((s, i) => s + i.duration_seconds, 0);
      const totalDist = workInvs.reduce((s, i) => s + i.distance_meters, 0);
      if (totalDist > 0 && totalDur > 0) {
        const rawPace = Math.round((totalDur / totalDist) * 1000);
        // If it was a 5K race, threshold pace is ~5% slower than 5K pace
        estimatedLt2Pace = runType === 'race' ? Math.round(rawPace * 1.045) : rawPace;
        estimatedLt2Hr = Math.round(workInvs.reduce((s, i) => s + i.avg_heart_rate * i.duration_seconds, 0) / totalDur);
      }
    }

    // Fallback if intervals not yet committed: evaluate core Z4/race segment
    if (!estimatedLt2Pace) {
      const highRecords = records.filter(r => r.heartRate && r.heartRate >= 165 && r.speedMps && r.speedMps > 2.8);
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
  if (isLt1Candidate || isLt2Candidate) {
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
    if (isLt1Candidate && isLt2Candidate) {
      note = `Calibrated dual LT1/LT2 baseline (${economy.aerobicDecouplingPct !== null ? `Decoupling: ${economy.aerobicDecouplingPct.toFixed(1)}%` : 'steady'})`;
    } else if (isLt1Candidate) {
      note = `Calibrated Aerobic Base (LT1) from steady aerobic run (${economy.aerobicDecouplingPct !== null ? `Decoupling: ${economy.aerobicDecouplingPct.toFixed(1)}%` : 'steady'})`;
    } else if (runType === 'race') {
      note = `Calibrated Lactate Threshold (LT2) from all-out 5K race pace`;
    } else {
      note = `Calibrated Lactate Threshold (LT2) from structured quality intervals`;
    }

    insertThreshold.run(
      runDate,
      activityId,
      estimatedLt1Hr,
      estimatedLt1Pace,
      estimatedLt2Hr,
      estimatedLt2Pace,
      baselineEconomyEf,
      isLt1Candidate ? 0.9 : 0.85,
      note
    );

    // Continuously update athlete_profile with the calibrated thresholds
    try {
      const updates: string[] = [];
      const params: any[] = [];
      if (estimatedLt1Hr) {
        updates.push('lt1_hr = ?');
        params.push(estimatedLt1Hr);
        updates.push('z3_start_hr = ?');
        params.push(estimatedLt1Hr + 1);
      }
      if (estimatedLt2Hr) {
        updates.push('lt2_hr = ?');
        params.push(estimatedLt2Hr);
        updates.push('z4_start_hr = ?');
        params.push(estimatedLt2Hr);
      }
      if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push('primary');
        db.prepare(`UPDATE athlete_profile SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      }
    } catch {
      // Non-fatal if table not created yet
    }
  }

  return {
    lt1Hr: estimatedLt1Hr,
    lt1PaceSecKm: estimatedLt1Pace,
    lt2Hr: estimatedLt2Hr,
    lt2PaceSecKm: estimatedLt2Pace,
    baselineEconomyEf
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
    const latest = db.prepare(`
      SELECT lt1_hr, lt2_hr, lt1_pace_sec_km, lt2_pace_sec_km, effective_date, confidence
      FROM physiological_thresholds
      WHERE lt1_hr IS NOT NULL OR lt2_hr IS NOT NULL
      ORDER BY effective_date DESC, id DESC
      LIMIT 1
    `).get() as any;

    const profile = db.prepare('SELECT lt1_hr, lt2_hr, lt1_min_hr, lt1_max_hr FROM athlete_profile WHERE id = ?').get('primary') as any;

    const lt1Hr = latest?.lt1_hr || profile?.lt1_hr || 148;
    const lt2Hr = latest?.lt2_hr || profile?.lt2_hr || 167;
    const minLt1 = profile?.lt1_min_hr || 147;
    const maxLt1 = profile?.lt1_max_hr || 149;

    return {
      lt1Hr,
      lt2Hr,
      lt1Range: [Math.min(minLt1, lt1Hr - 1), Math.max(maxLt1, lt1Hr + 1)],
      lt1PaceSecKm: latest?.lt1_pace_sec_km || null,
      lt2PaceSecKm: latest?.lt2_pace_sec_km || null,
      confidence: latest?.confidence || 1.0,
      source: latest ? 'calibrated' : 'baseline',
      lastCalibratedDate: latest?.effective_date || null
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
