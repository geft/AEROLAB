import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import type { AthleteHrProfile, RunType } from './classifier.js';
import type { ActivityRecord } from './csv-parser.js';
import type { DetectedInterval } from './interval-detector.js';
import { calculateZoneDistribution, getDefaultZones, getLt2TrainingBand } from '../physiology/zones.js';

/** Derived tags share the same recorded evidence during import and replay. */
export function buildSessionTags(
  runType: RunType, records: ActivityRecord[], intervals: DetectedInterval[], profile: AthleteHrProfile
): string[] {
  const labels: Record<RunType, string> = {
    easy_base: 'Easy Base', long_run: 'Long Run', threshold_lt2: 'Threshold',
    intervals_vo2: 'VO2 Max', race: 'Race', recovery: 'Recovery'
  };
  const tags = [labels[runType]];
  const { maxHr, restingHr, lt1Hr, lt2Hr } = resolveHeartRateProfile(profile);
  if (runType === 'long_run' && intervals.some(interval =>
    interval.type === 'work' && interval.durationSeconds >= 600 &&
    interval.avgHeartRate > lt1Hr && interval.avgHeartRate < getLt2TrainingBand(lt2Hr)[0])) {
    tags.push('Marathon Pace');
  }
  if (runType === 'easy_base') {
    const zones = calculateZoneDistribution(records, getDefaultZones(maxHr, lt1Hr, lt2Hr, restingHr));
    if (zones.z3Pct >= 25 || zones.z3Pct + zones.z4Pct >= 35) tags.push('Tempo');
  }
  if (intervals.some(interval => interval.type === 'stride')) tags.push('Strides');
  return tags;
}
