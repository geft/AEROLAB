import { WMO_CODES } from '../../../shared/weather-conditions.js';
import type { CoachMessage, CoachMessageId, CoachMessageParam, CoachCategoryId } from '../../../shared/coaching.js';
import { DYNAMIC_MESSAGE_TEXT } from './dynamic-messages.js';
/** English API copy remains the source of truth. IDs survive wording changes. */
export const MESSAGE_TEXT: Record<CoachMessageId, string> = {
  ...DYNAMIC_MESSAGE_TEXT,
  "headline.strong_aerobic_adaptation_session": "Strong Aerobic Adaptation Session",
  "headline.sustained_upper_aerobic_tempo": "Sustained Upper-Aerobic Tempo Run",
  "advice.review_tempo_against_planned_target": "Review the sustained work against your planned tempo or marathon-pace target. Warmup and cooldown should remain easy; LT2 and VO2 targets do not apply to this work.",
  "advice.prioritize_light_hydration_and_low_impact_movement_before": "Prioritize light hydration and low-impact movement before your next hard effort.",
  "headline.incomplete_aborted_quality_session": "Incomplete / Aborted Quality Session",
  "advice.assess_underlying_fatigue_heat_stress_or_nutrition_take": "Assess underlying fatigue, heat stress, or nutrition. Take a recovery day before attempting another quality stimulus.",
  "headline.all_out_benchmark_masterful_race_execution": "All-Out Benchmark / Masterful Race Execution",
  "headline.all_out_benchmark_effort_erratic_pacing": "All-Out Benchmark Effort (Erratic Pacing)",
  "advice.exceptional_competitive_effort_prioritize_complete_replenishment_deep_sleep": "Exceptional competitive effort. Prioritize complete replenishment, deep sleep, and gentle recovery jogging over the next 48-72 hours.",
  "advice.commendable_maximum_effort_in_your_next_benchmark_target": "Commendable maximum effort. In your next benchmark, target an even or slight negative split to avoid early lactic burn.",
  "headline.unintentional_tempo_drifted_aerobic_run": "Unintentional Tempo / Drifted Aerobic Run",
  "advice.easy_recovery_lt1_ceiling": "If an Easy recovery was intended, slow your initial kilometer pace by 15-20 sec/km to keep heart rate firmly under your LT1 ceiling ({lt1} bpm).",
  "headline.low_stress_active_recovery_jog": "Low-Stress Active Recovery Jog",
  "advice.superb_discipline_keeping_heart_rate_low_and_muscle": "Superb discipline keeping heart rate low and muscle tissue unstressed. Ready for your next scheduled quality day.",
  "headline.near_perfect_aerobic_base_execution": "Near-Perfect Aerobic Base Execution",
  "headline.productive_zone_2_aerobic_foundation": "Productive Zone 2 Aerobic Foundation",
  "advice.your_aerobic_system_is_absorbing_current_volume_smoothly": "Your aerobic system is absorbing current volume smoothly. Ready for a progressive tempo or threshold stimulus.",
  "advice.maintain_easy_efforts_at_this_heart_rate_cap": "Maintain easy efforts at this heart rate cap to reinforce mitochondrial density.",
  "headline.threshold_zone_not_verified": "Threshold Zone Not Verified",
  "headline.high_quality_lactate_clearance_stimulus": "High-Quality Lactate Clearance Stimulus",
  "headline.threshold_stimulus_with_compromised_execution": "Threshold Stimulus with Compromised Execution",
  "advice.allow_48_hours_of_recovery_or_easy_aerobic": "Allow 48 hours of recovery or easy aerobic jogging before your next quality interval day.",
  "headline.masterful_vo2_max_interval_execution": "Masterful VO2 Max Interval Execution",
  "headline.sharp_high_velocity_neuromuscular_stimulus": "Sharp High-Velocity Neuromuscular Stimulus",
  "advice.focus_on_leg_recovery_and_adequate_protein_intake": "Focus on leg recovery and adequate protein intake to rebuild fast-twitch muscle fibers.",
  "headline.marathon_pace_long_run": "Marathon-Pace Long Run",
  "advice.review_the_work_blocks_against_your_planned_marathon": "Review the work blocks against your planned marathon pace. The easy-run heart-rate ceiling does not apply to those blocks."
};
export function coachMessage(id: CoachMessageId, values: Record<string, CoachMessageParam | null | undefined> = {}): CoachMessage {
  const params = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value == null ? '—' : value]));
  const text = (value: CoachMessageParam): string => Array.isArray(value) ? value.map(text).join(text(params.separator ?? ''))
    : value !== null && typeof value === 'object' ? value.text : String(value);
  return { id, params, text: MESSAGE_TEXT[id].replace(/\{(\w+)\}/g, (token, key: string) => key in params ? text(params[key]) : token) };
}

export const coachDescription = (message: CoachMessage) => ({ description: message.text, descriptionMessage: message });
export const coachJoin = (items: CoachMessage[], separator: string): CoachMessage => coachMessage('fragment.join', { items, separator: separator === ' and ' ? coachMessage('fragment.and') : separator });
export const coachCategoryMessage = (category: CoachCategoryId): CoachMessage => coachMessage(`category.${category}`);

/** Known provider descriptions are normalized at the external-data boundary. */
export function coachWeatherCondition(condition: string | null | undefined): CoachMessage | string {
  const match = Object.entries(WMO_CODES).find(([, text]) => text === condition);
  return match ? coachMessage(`weather.${match[0]}` as CoachMessageId) : condition ?? '';
}
