import { sessionTags, type ElevationEvidence } from '../../shared/session-tags.js';
import { marathonPaceBlock, type AthleteHrProfile, type RunType } from './classifier.js';
import type { ActivityRecord } from './csv-parser.js';
import type { DetectedInterval } from './interval-detector.js';

/**
 * Derived tags share the same recorded evidence during import and replay.
 *
 * "Marathon Pace" is structural, not a label the athlete applies: it is true
 * exactly when the run is a long run carrying a sustained block above LT1 and
 * below the LT2 band. The coach uses it to grade the block as sustained work
 * while the run keeps its place in the long-run record.
 */
export function buildSessionTags(
  runType: RunType, _records: ActivityRecord[], intervals: DetectedInterval[], profile: AthleteHrProfile, elevation?: ElevationEvidence
): string[] {
  const structural = [
    ...(intervals.some(interval => interval.type === 'stride') ? ['Strides'] : []),
    ...(runType === 'long_run' && marathonPaceBlock(intervals, profile) ? ['Marathon Pace'] : [])
  ];
  return sessionTags(runType, structural, elevation);
}
