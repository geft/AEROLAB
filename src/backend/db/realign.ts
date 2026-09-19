import { detectIntervals } from '../ingestion/interval-detector.js';
import { classifyRun } from '../ingestion/classifier.js';
import { calculateEconomy, calculateKmSplits } from '../physiology/economy.js';
import { evaluateThresholdUpdate, getCurrentThresholds } from '../physiology/threshold-tracker.js';
import { syncAllCoachSummaries } from '../physiology/coach-summary.js';

export interface RealignStats {
  activitiesProcessed: number;
  activitiesSkipped: number;
  activitiesFailed: string[];
  runTypeChanges: { id: string; from: string; to: string }[];
  intervalsRebuilt: number;
  thresholdsPruned: number;
  profileLt1Hr: number | null;
  profileLt2Hr: number | null;
}

export interface RealignOptions {
  logger?: (msg: string) => void;
  /** Restrict to specific activity ids (default: all). */
  activityIds?: string[];
}

function mapRecords(rows: any[]): any[] {
  return rows.map(r => ({
    timestamp: r.timestamp,
    elapsedSeconds: r.elapsed_seconds,
    heartRate: r.heart_rate,
    cadence: r.cadence,
    speedMps: r.speed_mps,
    distanceMeters: r.distance_m,
    altitudeMeters: r.altitude_m,
    latitude: r.lat,
    longitude: r.lon,
    temperature: r.temp,
    verticalOscillation: r.vert_osc,
    stanceTime: r.stance_time
  }));
}

function readHrProfile(db: any): { maxHr: number | null; restingHr: number | null; lt1Hr: number | null; lt2Hr: number | null } {
  try {
    const prof = db.prepare('SELECT max_hr, resting_hr, lt1_hr, lt2_hr FROM athlete_profile WHERE id = ?').get('primary') as any;
    if (prof) {
      return { maxHr: prof.max_hr ?? null, restingHr: prof.resting_hr ?? null, lt1Hr: prof.lt1_hr ?? null, lt2Hr: prof.lt2_hr ?? null };
    }
  } catch { /* profile table may not exist yet */ }
  return { maxHr: null, restingHr: null, lt1Hr: null, lt2Hr: null };
}

function buildTags(runType: string, name: string, intervals: any[], hrProfile: { maxHr?: number | null; restingHr?: number | null; lt1Hr: number | null; lt2Hr: number | null }): string[] {
  const tags: string[] = [];
  if (runType === 'easy_base') tags.push('Easy Base');
  else if (runType === 'threshold_lt2') tags.push('Threshold');
  else if (runType === 'intervals_vo2') tags.push('VO2 Max');
  else if (runType === 'long_run') tags.push('Long Run');
  else if (runType === 'recovery') tags.push('Recovery');
  else if (runType === 'race') tags.push('Race');

  const nameLower = (name || '').toLowerCase();
  const mpLt1 = hrProfile.lt1Hr ?? (hrProfile.maxHr ? Math.round(hrProfile.maxHr * 0.73) : 148);
  const mpLt2 = hrProfile.lt2Hr ?? (hrProfile.maxHr ? Math.round(hrProfile.maxHr * 0.85) : 167);
  const hasMpBlocks =
    runType === 'long_run' &&
    (intervals.some((i: any) => i.type === 'work' && i.durationSeconds >= 600 && i.avgHeartRate >= mpLt1 - 2 && i.avgHeartRate <= mpLt2) ||
      nameLower.includes('marathon pace') || nameLower.includes('mp'));
  if (hasMpBlocks && !tags.includes('Marathon Pace')) tags.push('Marathon Pace');

  if (nameLower.includes('tempo') && !tags.includes('Tempo')) tags.push('Tempo');

  // Strides tag only from actually detected stride intervals — never from the
  // activity name, so runs can't carry a phantom Strides tag with an empty tab.
  if (intervals.some((i: any) => i.type === 'stride') && !tags.includes('Strides')) {
    tags.push('Strides');
  }
  return tags;
}

/**
 * Force-realigns stored analysis with the current detection/classification
 * code: re-detects intervals, re-classifies run types, rebuilds tags,
 * recomputes threshold calibrations (pruning stale rows whose source no
 * longer qualifies), re-syncs the athlete profile and coach summaries.
 *
 * Processing is chronological so threshold profile evolution stays correct,
 * and each activity is isolated — one corrupt activity can no longer abort
 * the whole pass (the previous silent failure mode that left DBs stale).
 */
export function realignDatabase(db: any, options: RealignOptions = {}): RealignStats {
  const log = options.logger ?? (() => {});
  const stats: RealignStats = {
    activitiesProcessed: 0,
    activitiesSkipped: 0,
    activitiesFailed: [],
    runTypeChanges: [],
    intervalsRebuilt: 0,
    thresholdsPruned: 0,
    profileLt1Hr: null,
    profileLt2Hr: null
  };

  let activities: any[];
  if (options.activityIds && options.activityIds.length > 0) {
    const placeholders = options.activityIds.map(() => '?').join(',');
    activities = db.prepare(
      `SELECT * FROM activities WHERE id IN (${placeholders}) ORDER BY start_time ASC`
    ).all(...options.activityIds) as any[];
  } else {
    activities = db.prepare('SELECT * FROM activities ORDER BY start_time ASC').all() as any[];
  }
  if (activities.length === 0) return stats;
  log(`Realigning ${activities.length} activities in chronological order...`);

  const insertInterval = db.prepare(`
    INSERT INTO activity_intervals (
      activity_id, interval_index, type, start_seconds, duration_seconds,
      distance_meters, avg_speed_mps, avg_pace_sec_km, avg_heart_rate,
      max_heart_rate, avg_cadence, peak_cadence, peak_speed_mps, peak_pace_sec_km,
      min_stance_time, hr_drop, avg_vert_osc, avg_stance_time,
      avg_step_length, avg_stride_length, avg_vert_ratio
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSplit = db.prepare(`
    INSERT INTO activity_splits (
      activity_id, split_index, distance_meters, duration_seconds,
      avg_pace_sec_km, avg_heart_rate, split_efficiency_factor, elevation_change_m,
      avg_cadence, avg_stance_time, avg_vert_osc, avg_vert_ratio
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Phase 1: per-activity intervals + classification + tags (isolated).
  // Threshold rows are left untouched here; phase 2 rebuilds them from scratch.
  const evaluated: { act: any; meta: any; mapped: any[]; economy: any; runType: string }[] = [];
  for (const act of activities) {
    try {
      const records = db.prepare('SELECT * FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(act.id) as any[];
      if (records.length <= 30) {
        stats.activitiesSkipped++;
        continue;
      }
      const mapped = mapRecords(records);
      const nameLower = (act.name || '').toLowerCase();
      const isRace =
        act.run_type === 'race' ||
        nameLower.includes('time trial') ||
        nameLower.includes(' tt') ||
        nameLower.includes('race') ||
        nameLower.includes('parkrun');
      const hrProfile = readHrProfile(db);
      const intervals = detectIntervals(mapped as any, {
        isRace,
        lt1Hr: hrProfile?.lt1Hr ?? undefined,
        lt2Hr: hrProfile?.lt2Hr ?? undefined,
        maxHr: hrProfile?.maxHr ?? undefined,
        restingHr: hrProfile?.restingHr ?? undefined
      });

      db.prepare('DELETE FROM activity_intervals WHERE activity_id = ?').run(act.id);
      for (const inv of intervals) {
        insertInterval.run(
          act.id, inv.intervalIndex, inv.type, inv.startSeconds, inv.durationSeconds,
          inv.distanceMeters, inv.avgSpeedMps, inv.avgPaceSecKm, inv.avgHeartRate,
          inv.maxHeartRate, inv.avgCadence, inv.peakCadence ?? null, inv.peakSpeedMps ?? null,
          inv.peakPaceSecKm ?? null, inv.minStanceTime ?? null, inv.hrDrop ?? null,
          (inv as any).avgVertOsc ?? null, (inv as any).avgStanceTime ?? null,
          (inv as any).avgStepLength ?? null, (inv as any).avgStrideLength ?? null,
          (inv as any).avgVertRatio ?? null
        );
      }
      stats.intervalsRebuilt += intervals.length;

      const economy = calculateEconomy(mapped as any);
      const meta = {
        id: act.id,
        name: act.name,
        sport: act.sport,
        date: act.start_time,
        totalDistanceMeters: act.distance_meters,
        totalDurationSeconds: act.duration_seconds,
        totalElapsedSeconds: act.elapsed_seconds || act.duration_seconds,
        avgHeartRate: act.avg_heart_rate,
        maxHeartRate: act.max_heart_rate,
        avgCadence: act.avg_cadence,
        maxCadence: act.max_cadence,
        calories: act.calories,
        totalAscentMeters: act.elevation_gain_m || 0,
        totalDescentMeters: act.elevation_loss_m || 0
      };
      const classification = classifyRun(meta, mapped as any, economy, intervals, hrProfile);
      const tags = buildTags(classification.runType, act.name, intervals, hrProfile);

      if (act.run_type !== classification.runType) {
        stats.runTypeChanges.push({ id: act.id, from: act.run_type, to: classification.runType });
      }
      db.prepare(`
        UPDATE activities SET
          run_type = ?,
          auto_run_type = ?,
          tags = ?,
          efficiency_factor = ?,
          aerobic_decoupling_pct = ?,
          meters_per_beat = ?,
          steady_pace_sec_km = ?,
          steady_heart_rate = ?,
          steady_cadence = ?,
          steady_stance_time = ?
        WHERE id = ?
      `).run(
        classification.runType,
        classification.runType,
        JSON.stringify(tags),
        economy.efficiencyFactor,
        economy.aerobicDecouplingPct,
        economy.metersPerBeat,
        economy.steadyPaceSecKm,
        economy.steadyHeartRate,
        economy.steadyCadence,
        economy.steadyStanceTimeMs,
        act.id
      );

      const splits = calculateKmSplits(mapped as any, 1000);
      if (splits.length > 0) {
        db.prepare('DELETE FROM activity_splits WHERE activity_id = ?').run(act.id);
        for (const s of splits) {
          insertSplit.run(
            act.id,
            s.splitIndex,
            s.distanceMeters,
            s.durationSeconds,
            s.avgPaceSecKm,
            s.avgHeartRate,
            s.splitEfficiencyFactor,
            s.elevationChangeM,
            s.avgCadence ?? null,
            s.avgStanceTimeMs ?? null,
            s.avgVertOscMm ?? null,
            s.avgVertRatioPct ?? null
          );
        }
      }

      evaluated.push({ act, meta, mapped, economy, runType: classification.runType });
      stats.activitiesProcessed++;
    } catch (err: any) {
      stats.activitiesFailed.push(`${act.id}: ${err?.message || err}`);
      log(`  FAILED ${act.id}: ${err?.message || err}`);
    }
  }

  // Phase 2: rebuild threshold calibrations chronologically. Stale rows whose
  // source activity no longer qualifies, or unphysiological rows (LT1 > 156 or pace < 200), are pruned first.
  try {
    // Initialize athlete_profile baseline cleanly before chronological threshold replay
    const prof = db.prepare('SELECT max_hr, resting_hr, age FROM athlete_profile WHERE id = ?').get('primary') as any;
    const effMax = prof?.max_hr || 203;
    const effRhr = prof?.resting_hr || 54;
    const initialLt1 = Math.round(effRhr + (effMax - effRhr) * 0.65); // ~151 bpm
    db.prepare(`
      UPDATE athlete_profile
      SET lt1_hr = ?, lt1_min_hr = ?, lt1_max_hr = ?, z3_start_hr = ?
      WHERE id = 'primary'
    `).run(initialLt1, initialLt1 - 1, initialLt1 + 1, initialLt1 + 1);

    const prunable = db.prepare(`
      DELETE FROM physiological_thresholds
      WHERE (lt1_hr IS NOT NULL AND lt1_hr > 156)
         OR (lt1_pace_sec_km IS NOT NULL AND lt1_pace_sec_km < 200)
         OR (source_activity_id IS NOT NULL AND source_activity_id IN (
        SELECT t.source_activity_id FROM physiological_thresholds t
        LEFT JOIN activities a ON a.id = t.source_activity_id
        WHERE a.id IS NULL OR (
          t.lt2_hr IS NOT NULL AND a.run_type NOT IN ('threshold_lt2', 'race')
        ) OR (
          t.lt1_hr IS NOT NULL AND t.lt2_hr IS NULL AND a.run_type NOT IN ('easy_base', 'long_run')
        )
      ))
    `).run();
    stats.thresholdsPruned += prunable.changes ?? 0;
  } catch (err: any) {
    log(`  threshold prune skipped: ${err?.message || err}`);
  }

  for (const e of evaluated) {
    try {
      evaluateThresholdUpdate(db, e.act.id, e.act.start_time, e.runType as any, e.meta, e.mapped as any, e.economy);
    } catch (err: any) {
      stats.activitiesFailed.push(`${e.act.id} (thresholds): ${err?.message || err}`);
      log(`  FAILED thresholds ${e.act.id}: ${err?.message || err}`);
    }
  }

  // Clean up any duplicate calibrations for identical source activities
  try {
    db.prepare(`
      DELETE FROM physiological_thresholds
      WHERE id NOT IN (
        SELECT MAX(id) FROM physiological_thresholds GROUP BY source_activity_id
      )
    `).run();
  } catch { /* non-fatal */ }

  // Phase 3: profile follows the latest calibrations; summaries follow all.
  try {
    const current = getCurrentThresholds(db);
    try {
      const prof = db.prepare('SELECT lt1_hr, lt2_hr FROM athlete_profile WHERE id = ?').get('primary') as any;
      if (prof) {
        if (current.lt1Hr !== prof.lt1_hr || current.lt2Hr !== prof.lt2_hr) {
          db.prepare('UPDATE athlete_profile SET lt1_hr = ?, lt2_hr = ?, lt1_min_hr = ?, lt1_max_hr = ?, z3_start_hr = ?, z4_start_hr = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(current.lt1Hr, current.lt2Hr, current.lt1Hr - 1, current.lt1Hr + 1, current.lt1Hr + 1, current.lt2Hr, 'primary');
          log(`  profile synced: LT1 ${prof.lt1_hr}->${current.lt1Hr}, LT2 ${prof.lt2_hr}->${current.lt2Hr}`);
        }
        stats.profileLt1Hr = current.lt1Hr;
        stats.profileLt2Hr = current.lt2Hr;
      }
    } catch { /* non-fatal */ }
  } catch (err: any) {
    log(`  profile sync skipped: ${err?.message || err}`);
  }

  try {
    const synced = syncAllCoachSummaries(db);
    log(`  coach summaries re-synced for ${synced} activities`);
  } catch (err: any) {
    log(`  coach re-sync skipped: ${err?.message || err}`);
  }

  log(`Done: ${stats.activitiesProcessed} processed, ${stats.activitiesSkipped} skipped, ` +
    `${stats.activitiesFailed.length} failed, ${stats.runTypeChanges.length} run-type changes, ` +
    `${stats.thresholdsPruned} stale threshold rows pruned.`);
  return stats;
}
