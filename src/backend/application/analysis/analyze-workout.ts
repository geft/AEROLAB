import type { ActivityMetadata, ActivityRecord } from '../../domain/telemetry.js';
import { repairSpeedTelemetry } from '../../domain/repair-speed.js';
import { prepareFitAnalysis, type AnalysisLap } from '../../ingestion/fit-analysis.js';
import { classifyRun, type AthleteHrProfile, type ClassificationResult, type RunType } from '../../ingestion/classifier.js';
import { detectIntervals, type DetectedInterval } from '../../ingestion/interval-detector.js';
import { buildSessionTags } from '../../ingestion/session-tags.js';
import { calculateEconomy, calculateKmSplits, type EconomyMetrics, type SplitLap } from '../../physiology/economy.js';

export interface PrecomputedWorkoutMetrics {
  economy: EconomyMetrics;
  splits: SplitLap[];
}

export interface WorkoutAnalysisInput {
  metadata: ActivityMetadata;
  rawRecords: ActivityRecord[];
  fitMetadata?: Record<string, unknown> | null;
  /** The caller selects evidence strictly preceding this workout. */
  historicalProfile: AthleteHrProfile;
  stridePaceAnchorSecKm?: number | null;
}

export interface AnalysisContext {
  metadata: ActivityMetadata;
  rawRecords: ActivityRecord[];
  records: ActivityRecord[];
  laps: AnalysisLap[];
  historicalProfile: AthleteHrProfile;
  stridePaceAnchorSecKm?: number | null;
  /** FIT annotations preserve timer provenance independently of speed repair. */
  hasTimerAnnotations: boolean;
  hasTelemetryChanges: boolean;
}

export interface WorkoutAnalysisResult extends PrecomputedWorkoutMetrics {
  context: AnalysisContext;
  classification: ClassificationResult;
  /** Athlete-confirmed intent takes precedence without replacing prediction. */
  runType: RunType;
  intervals: DetectedInterval[];
  tags: string[];
}

/** Prepare analysis-only records without modifying raw telemetry for export. */
export function prepareAnalysisContext(input: WorkoutAnalysisInput): AnalysisContext {
  const fit = prepareFitAnalysis(input.rawRecords, input.fitMetadata);
  const records = repairSpeedTelemetry(fit.records);
  return {
    metadata: input.metadata,
    rawRecords: input.rawRecords,
    records,
    laps: fit.laps,
    historicalProfile: input.historicalProfile,
    stridePaceAnchorSecKm: input.stridePaceAnchorSecKm,
    hasTimerAnnotations: fit.records !== input.rawRecords,
    hasTelemetryChanges: records !== input.rawRecords
  };
}

/** Shared import/replay calculation; persistence and historical lookup belong to callers. */
export function analyzeWorkout(
  context: AnalysisContext,
  options: { confirmedRunType?: RunType | null; precomputed?: PrecomputedWorkoutMetrics } = {}
): WorkoutAnalysisResult {
  const { metadata, records, historicalProfile: profile } = context;
  const cached = context.hasTelemetryChanges ? undefined : options.precomputed;
  const economy = cached?.economy ?? calculateEconomy(records);
  const splits = cached?.splits ?? calculateKmSplits(records, 1000);
  const intervalOptions = {
    laps: context.laps,
    lt1Hr: profile.lt1Hr ?? undefined,
    lt2Hr: profile.lt2Hr ?? undefined,
    maxHr: profile.maxHr ?? undefined,
    restingHr: profile.restingHr ?? undefined,
    stridePaceAnchorSecKm: context.stridePaceAnchorSecKm ?? undefined
  };
  let intervals = detectIntervals(records, intervalOptions);
  const classification = classifyRun(metadata, records, economy, intervals, profile);
  const runType = options.confirmedRunType || classification.runType;
  // Race segmentation follows effective intent, after the independent prediction.
  if (runType === 'race') intervals = detectIntervals(records, { ...intervalOptions, isRace: true });
  return { context, economy, splits, classification, runType, intervals,
    tags: buildSessionTags(runType, records, intervals, profile, {
      distance_meters: metadata.totalDistanceMeters,
      elevation_gain_m: metadata.totalAscentMeters,
      elevation_loss_m: metadata.totalDescentMeters
    }) };
}
