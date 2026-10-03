import type Database from 'better-sqlite3';
import type { ActivityMetadata, ActivityRecord } from '../domain/telemetry.js';
import { analyzeWorkout, prepareAnalysisContext } from '../application/analysis/analyze-workout.js';
import { getAthleteHeartRateProfile } from '../physiology/athlete-profile.js';
import type { EconomyMetrics, SplitLap } from '../physiology/economy.js';
import { ANALYSIS_RECORD_COLUMNS } from './analysis-records.js';
import { evaluateThresholdUpdate, getCurrentThresholds, getStridePaceAnchorSecKmAtDate, getHeartRateProfileAtDate } from '../physiology/threshold-tracker.js';
import { thresholdTime } from '../../shared/threshold-trend.js';
import { calculateActivityTrainingLoad } from '../physiology/training-load.js';
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
  /** Corrections must surface finalization failures; maintenance remains best effort. */
  strict?: boolean;
  logger?: (msg: string) => void;
  /** Restrict to specific activity ids (default: all). */
  activityIds?: string[];
  precomputed?: Map<string, { economy: EconomyMetrics; splits: SplitLap[] }>;
  onProgress?: (completed: number, total: number) => void;
}

function mapRecords(rows: any[]): ActivityRecord[] {
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
    stanceTime: r.stance_time,
    stepLength: r.step_length_m,
    verticalRatio: r.vertical_ratio,
    stanceTimeBalance: r.stance_time_balance,
    power: r.power_w,
    respirationRate: r.respiration_rate,
    coreTemperature: r.core_temperature_c,
    fractionalCadence: r.fractional_cadence
  }));
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
export function realignDatabase(db: Database.Database, options: RealignOptions = {}): RealignStats {
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
      `SELECT * FROM activities WHERE id IN (${placeholders}) ORDER BY julianday(start_time) ASC, id ASC`
    ).all(...options.activityIds) as any[];
  } else {
    activities = db.prepare('SELECT * FROM activities ORDER BY julianday(start_time) ASC, id ASC').all() as any[];
  }
  activities.sort((a, b) => thresholdTime(a.start_time) - thresholdTime(b.start_time) || a.id.localeCompare(b.id));
  if (activities.length === 0) return stats;
  log(`Realigning ${activities.length} activities in chronological order...`);
  const baseline = getAthleteHeartRateProfile(db, false);
  // Cache fields describe current fitness, not the starting state of history.
  db.prepare("UPDATE athlete_profile SET lt1_hr = ?, lt2_hr = ? WHERE id = 'primary'")
    .run(baseline.hasBaseline ? baseline.lt1Hr : null, baseline.hasBaseline ? baseline.lt2Hr : null);

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

  // Reject stale workout-derived observations before they can influence later
  // runs. Explicit dated external measurements survive without a source workout.
  const prunable = db.prepare(`
    DELETE FROM physiological_thresholds
    WHERE (lt1_hr IS NOT NULL AND (lt1_hr >= ? OR lt1_hr <= ?))
      OR (lt2_hr IS NOT NULL AND (lt2_hr >= ? OR lt2_hr <= ?))
      OR (lt1_pace_sec_km IS NOT NULL AND (lt1_pace_sec_km < 120 OR lt1_pace_sec_km > 1200))
      OR (lt2_pace_sec_km IS NOT NULL AND (lt2_pace_sec_km < 120 OR lt2_pace_sec_km > 1200))
      OR (source_kind = 'workout' AND (
        source_activity_id IS NULL OR source_activity_id NOT IN (SELECT id FROM activities)
        OR source_activity_id IN (
          SELECT t.source_activity_id FROM physiological_thresholds t
          JOIN activities a ON a.id = t.source_activity_id
          WHERE a.manual_failed_workout = 1
            OR (t.lt2_hr IS NOT NULL AND a.run_type NOT IN ('threshold_lt2', 'race'))
            OR (t.lt1_hr IS NOT NULL AND t.lt2_hr IS NULL AND a.run_type NOT IN ('easy_base', 'long_run'))
        )
      ))
  `).run(baseline.maxHr, baseline.restingHr, baseline.maxHr, baseline.restingHr);
  stats.thresholdsPruned += prunable.changes;

  // Each activity commits analysis and calibration together, in date order.
  // Earlier activities have already been rebuilt; current/future rows are
  // excluded from classification, so repeated replay is causal and deterministic.
  for (const [index, act] of activities.entries()) {
    try {
      const records = db.prepare(`SELECT ${ANALYSIS_RECORD_COLUMNS} FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC`).all(act.id) as any[];
      if (records.length <= 30) {
        stats.activitiesSkipped++;
        continue;
      }
      const rebuilt = db.transaction(() => {
        db.prepare("DELETE FROM physiological_thresholds WHERE source_activity_id = ? AND source_kind = 'workout'").run(act.id);
        const rawMapped = mapRecords(records);
        const storedFit = db.prepare('SELECT metadata_json FROM activity_fit_details WHERE activity_id = ?').get(act.id) as { metadata_json: string } | undefined;
        const hrProfile = getHeartRateProfileAtDate(db, act.start_time);
        const stridePaceAnchorSecKm = getStridePaceAnchorSecKmAtDate(db, act.start_time);
        const meta: ActivityMetadata = {
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
        const context = prepareAnalysisContext({ metadata: meta, rawRecords: rawMapped,
          fitMetadata: storedFit ? JSON.parse(storedFit.metadata_json) : undefined,
          historicalProfile: hrProfile, stridePaceAnchorSecKm });
        const { economy, splits, classification, runType, intervals, tags } = analyzeWorkout(context, {
          confirmedRunType: act.manual_run_type, precomputed: options.precomputed?.get(act.id)
        });
        const mapped = context.records;
        db.prepare('DELETE FROM activity_intervals WHERE activity_id = ?').run(act.id);
        for (const inv of intervals) {
          insertInterval.run(
            act.id, inv.intervalIndex, inv.type, inv.startSeconds, inv.durationSeconds,
            inv.distanceMeters, inv.avgSpeedMps, inv.avgPaceSecKm, inv.avgHeartRate,
            inv.maxHeartRate, inv.avgCadence, inv.peakCadence ?? null, inv.peakSpeedMps ?? null,
            inv.peakPaceSecKm ?? null, inv.minStanceTime ?? null, inv.hrDrop ?? null,
            inv.avgVertOsc ?? null, inv.avgStanceTime ?? null,
            inv.avgStepLength ?? null, inv.avgStrideLength ?? null,
            inv.avgVertRatio ?? null
          );
        }
        const load = calculateActivityTrainingLoad(mapped, hrProfile,
          { durationSeconds: act.duration_seconds, avgHeartRate: act.avg_heart_rate });
        db.prepare(`UPDATE activities SET training_load=?,z1_seconds=?,z2_seconds=?,z3_seconds=?,z4_seconds=?,z5_seconds=? WHERE id=?`)
          .run(load.trainingLoad, load.zones.z1Seconds, load.zones.z2Seconds, load.zones.z3Seconds,
            load.zones.z4Seconds, load.zones.z5Seconds, act.id);

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
            steady_stance_time = ?,
            pause_duration_seconds = ?,
            walk_duration_seconds = ?,
            walk_distance_meters = ?
          WHERE id = ?
        `).run(
          runType,
          classification.runType,
          JSON.stringify(tags),
          economy.efficiencyFactor,
          economy.aerobicDecouplingPct,
          economy.metersPerBeat,
          economy.steadyPaceSecKm,
          economy.steadyHeartRate,
          economy.steadyCadence,
          economy.steadyStanceTimeMs,
          economy.pauseBreakdown?.stopDurationSeconds ?? 0,
          economy.pauseBreakdown?.walkDurationSeconds ?? 0,
          economy.pauseBreakdown?.walkDistanceMeters ?? 0,
          act.id
        );

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

        if (act.manual_failed_workout !== 1)
          evaluateThresholdUpdate(db, act.id, act.start_time, runType, meta, mapped, economy, hrProfile);
        return { runType, intervalCount: intervals.length };
      })();
      stats.intervalsRebuilt += rebuilt.intervalCount;
      if (act.run_type !== rebuilt.runType)
        stats.runTypeChanges.push({ id: act.id, from: act.run_type, to: rebuilt.runType });
      stats.activitiesProcessed++;
    } catch (err: any) {
      stats.activitiesFailed.push(`${act.id}: ${err?.message || err}`);
      log(`  FAILED ${act.id}: ${err?.message || err}`);
    } finally {
      options.onProgress?.(index + 1, activities.length);
    }
  }

  // Clean up any duplicate calibrations for identical source activities
  try {
    db.prepare(`
      DELETE FROM physiological_thresholds
      WHERE source_kind = 'workout' AND source_activity_id IS NOT NULL AND id NOT IN (
        SELECT MAX(id) FROM physiological_thresholds WHERE source_kind = 'workout' AND source_activity_id IS NOT NULL GROUP BY source_activity_id
      )
    `).run();
  } catch (error) { if (options.strict) throw error; /* non-fatal maintenance */ }

  // Current profile follows the rebuilt history; each summary uses its own date.
  try {
    const current = getCurrentThresholds(db);
    try {
      const prof = db.prepare('SELECT lt1_hr, lt2_hr FROM athlete_profile WHERE id = ?').get('primary') as any;
      if (prof && getAthleteHeartRateProfile(db).hasBaseline) {
        if (current.lt1Hr !== prof.lt1_hr || current.lt2Hr !== prof.lt2_hr) {
          db.prepare('UPDATE athlete_profile SET lt1_hr = ?, lt2_hr = ?, lt1_min_hr = ?, lt1_max_hr = ?, z3_start_hr = ?, z4_start_hr = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(current.lt1Hr, current.lt2Hr, current.lt1Range[0], current.lt1Range[1], current.lt1Range[1], current.lt2Hr, 'primary');
          log(`  profile synced: LT1 ${prof.lt1_hr}->${current.lt1Hr}, LT2 ${prof.lt2_hr}->${current.lt2Hr}`);
        }
        stats.profileLt1Hr = current.lt1Hr;
        stats.profileLt2Hr = current.lt2Hr;
      }
    } catch (error) { if (options.strict) throw error; /* non-fatal maintenance */ }
  } catch (err: any) {
    if (options.strict) throw err;
    log(`  profile sync skipped: ${err?.message || err}`);
  }

  try {
    const synced = syncAllCoachSummaries(db, options.activityIds);
    log(`  coach summaries re-synced for ${synced} activities`);
  } catch (err: any) {
    if (options.strict) throw err;
    log(`  coach re-sync skipped: ${err?.message || err}`);
  }

  log(`Done: ${stats.activitiesProcessed} processed, ${stats.activitiesSkipped} skipped, ` +
    `${stats.activitiesFailed.length} failed, ${stats.runTypeChanges.length} run-type changes, ` +
    `${stats.thresholdsPruned} stale threshold rows pruned.`);
  return stats;
}
