import { decodeStoredJson } from './compression.js';
import { activityFromRow, objectRow } from './rows.js';
import type { Activity } from '../../shared/activity.js';
import type { RunType } from '../ingestion/classifier.js';
import { persistWorkoutSegments } from './workout-segments.js';
import { assertDatabaseWritable } from '../application/database-operations.js';
import type Database from 'better-sqlite3';
import type { ClassificationEvidence } from '../../shared/contracts/classification.js';
import type { ActivityMetadata } from '../domain/telemetry.js';
import { analyzeWorkout, prepareAnalysisContext } from '../application/analysis/analyze-workout.js';
import { getAthleteHeartRateProfile } from '../physiology/athlete-profile.js';
import type { EconomyMetrics, SplitLap } from '../physiology/economy.js';
import { ANALYSIS_RECORD_COLUMNS, analysisRecordFromRow } from './analysis-records.js';
import { evaluateThresholdUpdate, getCurrentThresholds, getStridePaceAnchorSecKmAtDate, getHeartRateProfileAtDate } from '../physiology/threshold-tracker.js';
import { thresholdTime } from '../../shared/threshold-trend.js';
import { calculateActivityTrainingLoad } from '../physiology/training-load.js';
import { syncAllCoachSummaries } from '../physiology/coach-summary.js';
import { withDerivedAnalysisBatch } from '../application/analysis/derived-batch.js';

export interface RealignStats {
  activitiesProcessed: number;
  activitiesSkipped: number;
  activitiesFailed: string[];
  runTypeChanges: { id: string; from: string; to: string }[];
  intervalsRebuilt: number;
  thresholdsPruned: number;
  profileLt1Hr: number | null;
  profileLt2Hr: number | null;
  /** Wall-clock seconds, split by phase so a slow pass is diagnosable. */
  replaySeconds: number;
  coachSyncSeconds: number;
  totalSeconds: number;
}

export interface RealignOptions {
  /** Corrections must surface finalization failures; maintenance remains best effort. */
  strict?: boolean;
  logger?: (msg: string) => void;
  /** Restrict to specific activity ids (default: all). */
  activityIds?: string[];
  precomputed?: Map<string, { economy: EconomyMetrics; splits: SplitLap[] }>;
  onProgress?: (completed: number, total: number, phase?: 'replay' | 'coach') => void;
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
  assertDatabaseWritable();
  // The pass recomputes derived metrics from telemetry it never rewrites, so
  // decoded records and aerobic observations are reused across the whole replay.
  return withDerivedAnalysisBatch(db, () => replayDatabase(db, options));
}

function replayDatabase(db: Database.Database, options: RealignOptions): RealignStats {
  const log = options.logger ?? (() => {});
  const startedAt = Date.now();
  const stats: RealignStats = {
    activitiesProcessed: 0,
    activitiesSkipped: 0,
    activitiesFailed: [],
    runTypeChanges: [],
    intervalsRebuilt: 0,
    thresholdsPruned: 0,
    profileLt1Hr: null,
    profileLt2Hr: null,
    replaySeconds: 0,
    coachSyncSeconds: 0,
    totalSeconds: 0
  };

  const classifications = new Map<string, ClassificationEvidence>();
  type ReplayActivity = Activity & { manual_run_type: RunType | null };
  const activity = (value: unknown): ReplayActivity => {
    const row = objectRow(value, 'activities');
    const manual = row.manual_run_type;
    if (manual != null && !['easy_base', 'long_run', 'tempo', 'threshold_lt2', 'intervals_vo2', 'race', 'recovery'].includes(String(manual))) throw new Error('Invalid activities.manual_run_type');
    return { ...activityFromRow(row), manual_run_type: manual as RunType | null ?? null };
  };
  let activities: ReplayActivity[];
  if (options.activityIds && options.activityIds.length > 0) {
    const placeholders = options.activityIds.map(() => '?').join(',');
    activities = db.prepare(
      `SELECT * FROM activities WHERE id IN (${placeholders}) ORDER BY julianday(start_time) ASC, id ASC`
    ).all(...options.activityIds).map(activity);
  } else {
    activities = db.prepare('SELECT * FROM activities ORDER BY julianday(start_time) ASC, id ASC').all().map(activity);
  }
  activities.sort((a, b) => thresholdTime(a.start_time) - thresholdTime(b.start_time) || a.id.localeCompare(b.id));
  if (activities.length === 0) return stats;
  log(`Realigning ${activities.length} activities in chronological order...`);
  const baseline = getAthleteHeartRateProfile(db, false);
  // Cache fields describe current fitness, not the starting state of history.
  db.prepare("UPDATE athlete_profile SET lt1_hr = ?, lt2_hr = ? WHERE id = 'primary'")
    .run(baseline.hasBaseline ? baseline.lt1Hr : null, baseline.hasBaseline ? baseline.lt2Hr : null);

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
          WHERE a.is_treadmill = 1
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
      const records = db.prepare(`SELECT ${ANALYSIS_RECORD_COLUMNS} FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC`).all(act.id).map(analysisRecordFromRow);
      if (records.length <= 30) {
        stats.activitiesSkipped++;
        continue;
      }
      const rebuilt = db.transaction(() => {
        db.prepare("DELETE FROM physiological_thresholds WHERE source_activity_id = ? AND source_kind = 'workout'").run(act.id);
        const rawMapped = records;
        const storedFit = db.prepare('SELECT metadata_json FROM activity_fit_details WHERE activity_id = ?').get(act.id) as { metadata_json: string | Buffer } | undefined;
        const hrProfile = getHeartRateProfileAtDate(db, act.start_time);
        const stridePaceAnchorSecKm = getStridePaceAnchorSecKmAtDate(db, act.start_time);
        const meta: ActivityMetadata = {
          id: act.id,
          name: act.name ?? '',
          sport: act.sport ?? 'running',
          isTreadmill: act.is_treadmill,
          date: act.start_time,
          totalDistanceMeters: act.distance_meters,
          totalDurationSeconds: act.duration_seconds,
          totalElapsedSeconds: act.elapsed_seconds || act.duration_seconds,
          avgHeartRate: act.avg_heart_rate ?? 0,
          maxHeartRate: act.max_heart_rate ?? 0,
          avgCadence: act.avg_cadence ?? 0,
          maxCadence: act.max_cadence ?? 0,
          calories: act.calories ?? 0,
          totalAscentMeters: act.elevation_gain_m || 0,
          totalDescentMeters: act.elevation_loss_m || 0
        };
        const context = prepareAnalysisContext({ metadata: meta, rawRecords: rawMapped,
          fitMetadata: storedFit ? JSON.parse(decodeStoredJson(storedFit.metadata_json)) : undefined,
          historicalProfile: hrProfile, stridePaceAnchorSecKm });
        const { economy, splits, classification, runType, intervals, tags } = analyzeWorkout(context, {
          confirmedRunType: act.manual_run_type, precomputed: options.precomputed?.get(act.id)
        });
        const mapped = context.records;
        persistWorkoutSegments(db, act.id, splits, intervals, true);
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

        evaluateThresholdUpdate(db, act.id, act.start_time, runType, meta, mapped, economy, hrProfile);
        return { runType, intervalCount: intervals.length, evidence: classification.evidence };
      })();
      classifications.set(act.id, rebuilt.evidence);
      stats.intervalsRebuilt += rebuilt.intervalCount;
      if (act.run_type !== rebuilt.runType)
        stats.runTypeChanges.push({ id: act.id, from: act.run_type ?? '', to: rebuilt.runType });
      stats.activitiesProcessed++;
    } catch (err) {
      stats.activitiesFailed.push(`${act.id}: ${err instanceof Error ? err.message : String(err)}`);
      log(`  FAILED ${act.id}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      options.onProgress?.(index + 1, activities.length, 'replay');
    }
  }

  // A strict correction reports replay failures before finalization can mask them.
  if (options.strict && stats.activitiesFailed.length) {
    stats.totalSeconds = secondsSince(startedAt);
    return stats;
  }

  stats.replaySeconds = secondsSince(startedAt);
  log(`  replay finished in ${durationText(stats.replaySeconds)}`);

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
      const prof = db.prepare('SELECT lt1_hr, lt2_hr FROM athlete_profile WHERE id = ?').get('primary') as { lt1_hr: number | null; lt2_hr: number | null } | undefined;
      if (prof && getAthleteHeartRateProfile(db).hasBaseline) {
        if (current.lt1Hr !== prof.lt1_hr || current.lt2Hr !== prof.lt2_hr) {
          db.prepare('UPDATE athlete_profile SET lt1_hr = ?, lt2_hr = ?, lt1_min_hr = ?, lt1_max_hr = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(current.lt1Hr, current.lt2Hr, current.lt1Range[0], current.lt1Range[1], 'primary');
          log(`  profile synced: LT1 ${prof.lt1_hr}->${current.lt1Hr}, LT2 ${prof.lt2_hr}->${current.lt2Hr}`);
        }
        stats.profileLt1Hr = current.lt1Hr;
        stats.profileLt2Hr = current.lt2Hr;
      }
    } catch (error) { if (options.strict) throw error; /* non-fatal maintenance */ }
  } catch (err) {
    if (options.strict) throw err;
    log(`  profile sync skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const coachStartedAt = Date.now();
    const total = options.activityIds?.length ?? activities.length;
    log(`  re-syncing coach summaries for ${total} activities...`);
    const synced = syncAllCoachSummaries(db, options.activityIds, classifications, {
      onProgress: (completed, count) => options.onProgress?.(completed, count, 'coach')
    });
    stats.coachSyncSeconds = secondsSince(coachStartedAt);
    log(`  coach summaries re-synced for ${synced} activities in ${durationText(stats.coachSyncSeconds)}`);
  } catch (err) {
    if (options.strict) throw err;
    log(`  coach re-sync skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  stats.totalSeconds = secondsSince(startedAt);
  log(`Done: ${stats.activitiesProcessed} processed, ${stats.activitiesSkipped} skipped, ` +
    `${stats.activitiesFailed.length} failed, ${stats.runTypeChanges.length} run-type changes, ` +
    `${stats.thresholdsPruned} stale threshold rows pruned in ${durationText(stats.totalSeconds)}.`);
  return stats;
}

function secondsSince(startedAt: number): number {
  return Math.round((Date.now() - startedAt) / 100) / 10;
}

function durationText(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
}
