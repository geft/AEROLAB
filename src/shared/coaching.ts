import { COACH_DYNAMIC_MESSAGE_IDS } from './coach-dynamic-messages.js';
/** Stable machine identifiers; English presentation is owned by the backend. */
export const COACH_CATEGORY_IDS = [
  'sustained_intensity',
  'running_turnover',
  'aerobic_intensity',
  'workout_completion',
  'threshold_zone_time',
  'interval_execution',
  'cardiovascular_stimulus',
  'threshold_heart_rate',
  'pacing_discipline',
  'rep_to_rep_fatigue',
  'race_pacing_execution',
  'race_finish_execution',
  'aerobic_decoupling',
  'pacing_consistency',
  'autonomic_recovery',
] as const;
export type CoachCategoryId = typeof COACH_CATEGORY_IDS[number];
export const COACH_FINDING_IDS = [
  'controlled_upper_aerobic_work',
  'mixed_upper_aerobic_work',
  'missed_upper_aerobic_work',
  'steady_sustained_pacing',
  'uneven_sustained_pacing',
  'volatile_sustained_pacing',
  'optimal_cadence_sweet_spot',
  'adequate_turnover',
  'sub_optimal_cadence_turnover',
  'extended_above_the_lt1_ceiling',
  'clearly_easy',
  'normal_easy',
  'upper_easy_aerobic_steady',
  'potentially_too_close_to_lt1',
  'disciplined_aerobic_ceiling',
  'aborted_incomplete_quality_workout',
  'unbroken_session',
  'substantially_walked_session',
  'walk_dominated_session',
  'sustained_threshold_heart_rate',
  'partial_threshold_exposure',
  'little_threshold_exposure',
  'laser_rep_consistency',
  'disciplined_interval_structure',
  'high_rep_variance_across_set',
  'target_vo2_stimulus_achieved',
  'partial_cardiovascular_stimulus',
  'insufficient_cardiovascular_stimulus',
  'drifted_into_vo2_territory',
  'on_target_intensity_control',
  'grey_zone_intensity_drift',
  'overreaching_intensity',
  'held_rep_pace_and_hr_to_the_end',
  'slight_late_rep_fade',
  'late_rep_collapse',
  'rep_interrupting_walk_breaks',
  'minor_break_time',
  'heavily_interrupted_session',
  'aggressive_early_surge_positive_split',
  'laser_race_pacing_discipline',
  'controlled_race_pacing',
  'volatile_split_pacing',
  'strong_negative_split_finish',
  'held_form_to_the_line',
  'late_race_fade',
  'full_race_day_heart_rate_utilisation',
  'partial_race_day_effort',
  'conservative_heart_rate_ceiling',
  'walk_breaks_inside_the_race_effort',
  'drifting_into_high_zone_2',
] as const;
export type CoachFindingId = typeof COACH_FINDING_IDS[number];
export type RunFamily = 'aerobic' | 'quality' | 'race';
export interface CoachingFactor {
  categoryId?: CoachCategoryId;
  findingId?: CoachFindingId;
  category: string;
  label: string;
  description?: string;
  descriptionMessage?: CoachMessage;
  points: number;
  maxPoints: number;
  isFocus?: boolean;
}

export const COACH_MESSAGE_IDS = [
  ...COACH_DYNAMIC_MESSAGE_IDS,
  "headline.strong_aerobic_adaptation_session",
  "headline.sustained_upper_aerobic_tempo",
  "advice.review_tempo_against_planned_target",
  "advice.prioritize_light_hydration_and_low_impact_movement_before",
  "headline.incomplete_aborted_quality_session",
  "advice.assess_underlying_fatigue_heat_stress_or_nutrition_take",
  "headline.all_out_benchmark_masterful_race_execution",
  "headline.all_out_benchmark_effort_erratic_pacing",
  "advice.exceptional_competitive_effort_prioritize_complete_replenishment_deep_sleep",
  "advice.commendable_maximum_effort_in_your_next_benchmark_target",
  "headline.unintentional_tempo_drifted_aerobic_run",
  "advice.easy_recovery_lt1_ceiling",
  "headline.low_stress_active_recovery_jog",
  "advice.superb_discipline_keeping_heart_rate_low_and_muscle",
  "headline.near_perfect_aerobic_base_execution",
  "headline.productive_zone_2_aerobic_foundation",
  "advice.your_aerobic_system_is_absorbing_current_volume_smoothly",
  "advice.maintain_easy_efforts_at_this_heart_rate_cap",
  "headline.threshold_zone_not_verified",
  "headline.high_quality_lactate_clearance_stimulus",
  "headline.threshold_stimulus_with_compromised_execution",
  "advice.allow_48_hours_of_recovery_or_easy_aerobic",
  "headline.masterful_vo2_max_interval_execution",
  "headline.sharp_high_velocity_neuromuscular_stimulus",
  "advice.focus_on_leg_recovery_and_adequate_protein_intake",
  "headline.marathon_pace_long_run",
  "advice.review_the_work_blocks_against_your_planned_marathon",
] as const;
export type CoachMessageId = typeof COACH_MESSAGE_IDS[number];
export type CoachMessageParam = string | number | CoachMessage | CoachMessageParam[];
export interface CoachMessage { id: CoachMessageId; text: string; params: Record<string, CoachMessageParam> }
export interface CoachMessages { headline: CoachMessage; recommendation: CoachMessage }
/** Nested message parameters localize optional clauses without parsing their English. */
export function parseCoachMessage(value: unknown, depth = 0): CoachMessage | undefined {
  if (depth > 12 || !value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !(COACH_MESSAGE_IDS as readonly string[]).includes(row.id) || typeof row.text !== 'string'
    || !row.params || typeof row.params !== 'object' || Array.isArray(row.params)) return undefined;
  const validParam = (param: unknown, level: number): boolean => level <= 12 && (typeof param === 'string'
    || typeof param === 'number' && Number.isFinite(param)
    || Array.isArray(param) && param.length <= 500 && param.every(item => validParam(item, level + 1))
    || !!parseCoachMessage(param, level + 1));
  return Object.values(row.params).every(param => validParam(param, depth)) ? row as unknown as CoachMessage : undefined;
}
export function parseCoachMessageArray(value: unknown): CoachMessage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const messages = value.map(item => parseCoachMessage(item));
  return messages.every((message): message is CoachMessage => !!message) ? messages : undefined;
}
/** Treat persisted JSON as untrusted; absent legacy messages use the text adapter. */
export function parseCoachMessages(value: unknown): CoachMessages | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const headline = parseCoachMessage(row.headline), recommendation = parseCoachMessage(row.recommendation);
  return headline && recommendation ? { headline, recommendation } : undefined;
}
