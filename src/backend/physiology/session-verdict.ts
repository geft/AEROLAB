import type { SessionVerdict } from '../../shared/session-verdict.js';
import type { RubricFactor, RunFamily } from './coach-rubric.js';

// Use the engine's purpose-specific findings, never its aggregate score.
// Form, cadence, economy and weather observations do not change the verdict.
const findings: Record<string, Exclude<SessionVerdict, 'insufficient_evidence'>> = {
  'Disciplined Aerobic Ceiling': 'on_track',
  'Clearly Easy': 'on_track',
  'Normal Easy': 'on_track',
  'Upper Easy / Aerobic Steady': 'some_deviation',
  'Potentially Too Close to LT1': 'some_deviation',
  'Drifting Into High Zone 2': 'some_deviation',
  'Extended Above the LT1 Ceiling': 'off_target',
  'On-Target Intensity Control': 'on_track',
  'Grey-Zone Intensity Drift': 'some_deviation',
  'Overreaching Intensity': 'off_target',
  'Drifted Into VO2 Territory': 'off_target',
  'Sustained Threshold Heart Rate': 'on_track',
  'Partial Threshold Exposure': 'some_deviation',
  'Little Threshold Exposure': 'off_target',
  'Laser Rep Consistency': 'on_track',
  'Disciplined Interval Structure': 'on_track',
  'High Rep Variance Across Set': 'some_deviation',
  'Held Rep Pace and HR to the End': 'on_track',
  'Slight Late-Rep Fade': 'some_deviation',
  'Late-Rep Collapse': 'off_target',
  'Laser Race Pacing Discipline': 'on_track',
  'Controlled Race Pacing': 'on_track',
  'Aggressive Early Surge / Positive Split': 'some_deviation',
  'Volatile Split Pacing': 'some_deviation',
  'Strong Negative-Split Finish': 'on_track',
  'Held Form to the Line': 'on_track',
  'Late-Race Fade': 'some_deviation',
  'Unbroken Session': 'on_track',
  'Minor Break Time': 'some_deviation',
  'Rep-Interrupting Walk Breaks': 'some_deviation',
  'Walk Breaks Inside the Race Effort': 'some_deviation',
  'Heavily Interrupted Session': 'off_target',
  'Substantially Walked Session': 'some_deviation',
  'Walk-Dominated Session': 'off_target',
  'Aborted / Incomplete Quality Workout': 'off_target'
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
  // These session types need a dedicated target model; LT2 is not their target.
  if (['strides', 'tempo', 'marathon_pace'].includes(input.runType)) return 'insufficient_evidence';
  const primary = input.runType === 'threshold_lt2' ? ['Threshold Zone Time']
    : input.family === 'aerobic' ? ['Aerobic Intensity']
    : input.family === 'quality' ? ['Pacing Discipline', 'Interval Execution']
      : ['Race Pacing Execution', 'Race Finish Execution'];
  if (input.family === 'aerobic' && !input.hasIntensityTelemetry) return 'insufficient_evidence';
  if (!primary.every(category => input.factors.some(f => f.category === category && findings[f.label]))) {
    return 'insufficient_evidence';
  }
  const relevant = new Set([...primary, 'Workout Completion', ...(input.family === 'quality' && input.runType !== 'threshold_lt2' ? ['Rep-to-Rep Fatigue'] : [])]);
  const verdicts = input.factors.filter(f => relevant.has(f.category)).map(f => findings[f.label]);
  if (verdicts.includes('off_target')) return 'off_target';
  if (verdicts.includes('some_deviation')) return 'some_deviation';
  return 'on_track';
}
