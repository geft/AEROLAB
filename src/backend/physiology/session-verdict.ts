import type { SessionVerdict } from '../../shared/session-verdict.js';
import type { CoachingFactor as RubricFactor, CoachFindingId, RunFamily } from '../../shared/coaching.js';
import { identifyLegacyFactor } from '../domain/coaching/vocabulary.js';

// Use the engine's purpose-specific findings, never its aggregate score.
// Form, cadence, economy and weather observations do not change the verdict.
const findings: Partial<Record<CoachFindingId, Exclude<SessionVerdict, 'insufficient_evidence'>>> = {
  'controlled_upper_aerobic_work': 'on_track',
  'mixed_upper_aerobic_work': 'some_deviation',
  'missed_upper_aerobic_work': 'off_target',
  'steady_sustained_pacing': 'on_track',
  'uneven_sustained_pacing': 'some_deviation',
  'volatile_sustained_pacing': 'off_target',
  'disciplined_aerobic_ceiling': 'on_track',
  'clearly_easy': 'on_track',
  'normal_easy': 'on_track',
  'upper_easy_aerobic_steady': 'some_deviation',
  'potentially_too_close_to_lt1': 'some_deviation',
  'drifting_into_high_zone_2': 'some_deviation',
  'extended_above_the_lt1_ceiling': 'off_target',
  'on_target_intensity_control': 'on_track',
  'grey_zone_intensity_drift': 'some_deviation',
  'overreaching_intensity': 'off_target',
  'drifted_into_vo2_territory': 'off_target',
  'sustained_threshold_heart_rate': 'on_track',
  'partial_threshold_exposure': 'some_deviation',
  'little_threshold_exposure': 'off_target',
  'laser_rep_consistency': 'on_track',
  'disciplined_interval_structure': 'on_track',
  'high_rep_variance_across_set': 'some_deviation',
  'held_rep_pace_and_hr_to_the_end': 'on_track',
  'slight_late_rep_fade': 'some_deviation',
  'late_rep_collapse': 'off_target',
  'laser_race_pacing_discipline': 'on_track',
  'controlled_race_pacing': 'on_track',
  'aggressive_early_surge_positive_split': 'some_deviation',
  'volatile_split_pacing': 'some_deviation',
  'strong_negative_split_finish': 'on_track',
  'held_form_to_the_line': 'on_track',
  'late_race_fade': 'some_deviation',
  'unbroken_session': 'on_track',
  'minor_break_time': 'some_deviation',
  'rep_interrupting_walk_breaks': 'some_deviation',
  'walk_breaks_inside_the_race_effort': 'some_deviation',
  'heavily_interrupted_session': 'off_target',
  'substantially_walked_session': 'some_deviation',
  'walk_dominated_session': 'off_target',
  'aborted_incomplete_quality_workout': 'off_target'
};

export function sessionVerdict(input: {
  family: RunFamily;
  factors: RubricFactor[];
  hasIntensityTelemetry: boolean;
  isFailedWorkout: boolean;
  isAccidentalTempo: boolean;
  runType: string;
}): SessionVerdict {
  if (input.isFailedWorkout || input.isAccidentalTempo) return 'off_target';
  // Strides still need a dedicated target model. Sustained work is assessed
  // against observed upper-aerobic execution, not a prescribed marathon pace.
  if (input.runType === 'strides') return 'insufficient_evidence';
  const sustained = ['tempo', 'marathon_pace'].includes(input.runType);
  const primary = sustained ? ['sustained_intensity', 'pacing_consistency']
    : input.runType === 'threshold_lt2' ? ['threshold_zone_time']
    : input.family === 'aerobic' ? ['aerobic_intensity']
    : input.family === 'quality' ? ['pacing_discipline', 'interval_execution']
      : ['race_pacing_execution', 'race_finish_execution'];
  if (input.family === 'aerobic' && !input.hasIntensityTelemetry) return 'insufficient_evidence';
  const factors = input.factors.map(identifyLegacyFactor);
  if (!primary.every(categoryId => factors.some(f => f.categoryId === categoryId && f.findingId && findings[f.findingId]))) {
    return 'insufficient_evidence';
  }
  const relevant = new Set([...primary, 'workout_completion', ...(input.family === 'quality' && input.runType !== 'threshold_lt2' && !sustained ? ['rep_to_rep_fatigue'] : [])]);
  const verdicts = factors.filter(f => f.categoryId && relevant.has(f.categoryId)).map(f => f.findingId && findings[f.findingId]);
  if (verdicts.includes('off_target')) return 'off_target';
  if (verdicts.includes('some_deviation')) return 'some_deviation';
  return 'on_track';
}
