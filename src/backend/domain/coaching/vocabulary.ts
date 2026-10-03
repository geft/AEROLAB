import type { CoachCategoryId, CoachFindingId, CoachingFactor } from '../../../shared/coaching.js';

export const CATEGORY_TEXT: Record<CoachCategoryId, string> = {
  "running_turnover": "Running Turnover",
  "aerobic_intensity": "Aerobic Intensity",
  "workout_completion": "Workout Completion",
  "threshold_zone_time": "Threshold Zone Time",
  "interval_execution": "Interval Execution",
  "cardiovascular_stimulus": "Cardiovascular Stimulus",
  "threshold_heart_rate": "Threshold Heart Rate",
  "pacing_discipline": "Pacing Discipline",
  "rep_to_rep_fatigue": "Rep-to-Rep Fatigue",
  "race_pacing_execution": "Race Pacing Execution",
  "race_finish_execution": "Race Finish Execution",
  "aerobic_decoupling": "Aerobic Decoupling",
  "pacing_consistency": "Pacing Consistency",
  "autonomic_recovery": "Autonomic Recovery"
};
export const FINDING_TEXT: Record<CoachFindingId, string> = {
  "optimal_cadence_sweet_spot": "Optimal Cadence Sweet Spot",
  "adequate_turnover": "Adequate Turnover",
  "sub_optimal_cadence_turnover": "Sub-Optimal Cadence Turnover",
  "extended_above_the_lt1_ceiling": "Extended Above the LT1 Ceiling",
  "clearly_easy": "Clearly Easy",
  "normal_easy": "Normal Easy",
  "upper_easy_aerobic_steady": "Upper Easy / Aerobic Steady",
  "potentially_too_close_to_lt1": "Potentially Too Close to LT1",
  "disciplined_aerobic_ceiling": "Disciplined Aerobic Ceiling",
  "aborted_incomplete_quality_workout": "Aborted / Incomplete Quality Workout",
  "unbroken_session": "Unbroken Session",
  "substantially_walked_session": "Substantially Walked Session",
  "walk_dominated_session": "Walk-Dominated Session",
  "sustained_threshold_heart_rate": "Sustained Threshold Heart Rate",
  "partial_threshold_exposure": "Partial Threshold Exposure",
  "little_threshold_exposure": "Little Threshold Exposure",
  "laser_rep_consistency": "Laser Rep Consistency",
  "disciplined_interval_structure": "Disciplined Interval Structure",
  "high_rep_variance_across_set": "High Rep Variance Across Set",
  "target_vo2_stimulus_achieved": "Target VO2 Stimulus Achieved",
  "partial_cardiovascular_stimulus": "Partial Cardiovascular Stimulus",
  "insufficient_cardiovascular_stimulus": "Insufficient Cardiovascular Stimulus",
  "drifted_into_vo2_territory": "Drifted Into VO2 Territory",
  "on_target_intensity_control": "On-Target Intensity Control",
  "grey_zone_intensity_drift": "Grey-Zone Intensity Drift",
  "overreaching_intensity": "Overreaching Intensity",
  "held_rep_pace_and_hr_to_the_end": "Held Rep Pace and HR to the End",
  "slight_late_rep_fade": "Slight Late-Rep Fade",
  "late_rep_collapse": "Late-Rep Collapse",
  "rep_interrupting_walk_breaks": "Rep-Interrupting Walk Breaks",
  "minor_break_time": "Minor Break Time",
  "heavily_interrupted_session": "Heavily Interrupted Session",
  "aggressive_early_surge_positive_split": "Aggressive Early Surge / Positive Split",
  "laser_race_pacing_discipline": "Laser Race Pacing Discipline",
  "controlled_race_pacing": "Controlled Race Pacing",
  "volatile_split_pacing": "Volatile Split Pacing",
  "strong_negative_split_finish": "Strong Negative-Split Finish",
  "held_form_to_the_line": "Held Form to the Line",
  "late_race_fade": "Late-Race Fade",
  "full_race_day_heart_rate_utilisation": "Full Race-Day Heart Rate Utilisation",
  "partial_race_day_effort": "Partial Race-Day Effort",
  "conservative_heart_rate_ceiling": "Conservative Heart Rate Ceiling",
  "walk_breaks_inside_the_race_effort": "Walk Breaks Inside the Race Effort",
  "drifting_into_high_zone_2": "Drifting Into High Zone 2"
};
export const category = (categoryId: CoachCategoryId) => ({ categoryId, category: CATEGORY_TEXT[categoryId] });
export const finding = (findingId: CoachFindingId) => ({ findingId, label: FINDING_TEXT[findingId] });

const oldCategories = new Map(Object.entries(CATEGORY_TEXT).map(([key, value]) => [value, key as CoachCategoryId]));
const oldFindings = new Map(Object.entries(FINDING_TEXT).map(([key, value]) => [value, key as CoachFindingId]));
/** Compatibility only: new grading branches emit IDs directly. */
export function identifyLegacyFactor(factor: CoachingFactor) {
  return { categoryId: factor.categoryId ?? oldCategories.get(factor.category),
    findingId: factor.findingId ?? oldFindings.get(factor.label) };
}
