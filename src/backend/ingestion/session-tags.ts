import { sessionTags } from '../../shared/session-tags.js';
import type { AthleteHrProfile, RunType } from './classifier.js';
import type { ActivityRecord } from './csv-parser.js';
import type { DetectedInterval } from './interval-detector.js';

/** Derived tags share the same recorded evidence during import and replay. */
export function buildSessionTags(
  runType: RunType, _records: ActivityRecord[], intervals: DetectedInterval[], _profile: AthleteHrProfile
): string[] {
  return sessionTags(runType, intervals.some(interval => interval.type === 'stride') ? ['Strides'] : []);
}
