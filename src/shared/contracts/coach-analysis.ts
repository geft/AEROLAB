import { COACH_CATEGORY_IDS, COACH_FINDING_IDS, parseCoachMessage } from '../coaching.js';
import type { CoachContext, CoachInsightTone, ScoreFactor, WalkAudit } from './activity-detail.js';
import type { PauseBreakdown } from '../activity-detail.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nullableNumber = (value: unknown): boolean => value == null || finite(value);

/** Persisted JSON is a runtime boundary, including read-only legacy snapshots. */
export function parseScoreFactors(value: unknown): ScoreFactor[] {
  if (!Array.isArray(value)) return [];
  return value.filter((factor): factor is ScoreFactor => object(factor)
    && typeof factor.category === 'string' && typeof factor.label === 'string' && finite(factor.points)
    && (factor.maxPoints == null || finite(factor.maxPoints))
    && (factor.categoryId == null || typeof factor.categoryId === 'string' && (COACH_CATEGORY_IDS as readonly string[]).includes(factor.categoryId))
    && (factor.findingId == null || typeof factor.findingId === 'string' && (COACH_FINDING_IDS as readonly string[]).includes(factor.findingId))
    && (factor.description == null || typeof factor.description === 'string')
    && (factor.isFocus == null || typeof factor.isFocus === 'boolean'))
    .map(factor => ({ ...factor, descriptionMessage: parseCoachMessage(factor.descriptionMessage) }));
}

export function parseInsightTones(value: unknown): CoachInsightTone[] {
  return Array.isArray(value) && value.every(tone => tone === 'positive' || tone === 'neutral' || tone === 'caution' || tone === 'negative') ? value : [];
}

export function parseCoachContext(value: unknown): CoachContext | null {
  if (!object(value) || !['windowDays', 'comparableRuns', 'baselineEfSamples', 'hrAtPaceSamples', 'decouplingSamples'].every(key => finite(value[key]))
    || typeof value.isLongestRun !== 'boolean'
    || !['baselineEf', 'efDeltaPct', 'baselineHrAtPace', 'hrAtPaceDeltaBpm', 'currentPaceSecKm', 'decouplingRank', 'decouplingBestPct', 'longestDistanceKm', 'acute7DayLoad', 'chronicWeeklyLoad', 'acwr'].every(key => value[key] === null || finite(value[key]))
    || !['currentHeartRate', 'currentAboveCeilingPct'].every(key => nullableNumber(value[key]))
    || (value.runFamily != null && !['aerobic', 'quality', 'race'].includes(String(value.runFamily)))) return null;
  const previous = value.lastSimilarRun;
  if (previous != null && (!object(previous) || typeof previous.id !== 'string' || typeof previous.startTime !== 'string'
    || !['distanceKm', 'paceSecKm', 'heartRate'].every(key => finite(previous[key])) || !nullableNumber(previous.aboveCeilingPct))) return null;
  return value as unknown as CoachContext;
}

export function parseWalkAudit(value: unknown): WalkAudit | null {
  if (!object(value) || typeof value.plannedPattern !== 'boolean'
    || !['blockCount', 'walkSec', 'movingSec', 'deliberateWalkSec', 'preventiveWalkSec', 'correctiveWalkSec', 'hardWalkSec', 'capacityWalkSec', 'intrusiveWalkSec'].every(key => finite(value[key]))
    || !['avgPreventiveEntryHr', 'avgCorrectiveEntryHr', 'avgCapacityEntryHr', 'maxEntryHr'].every(key => value[key] === null || finite(value[key]))
    || !['rawBlockCount', 'recoveryWalkSec', 'recoveryBlockCount', 'artifactWalkSec', 'artifactBlockCount'].every(key => nullableNumber(value[key]))) return null;
  return value as unknown as WalkAudit;
}

export function parsePauseBreakdown(value: unknown): Partial<PauseBreakdown> | null {
  if (!object(value) || !Object.values(value).every(nullableNumber)) return null;
  return value as Partial<PauseBreakdown>;
}
