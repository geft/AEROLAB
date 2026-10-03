import type Database from 'better-sqlite3';
import { rebuildAffectedHistory } from '../application/analysis/rebuild-history.js';
import { syncAllCoachSummaries } from './coach-summary.js';

/** Baseline changes affect all inferred history, not just stored load and coaching. */
export function recomputeProfileDerivedData(db: Database.Database, baselineChanged: boolean): number {
  if (baselineChanged) return rebuildAffectedHistory(db).activitiesProcessed;
  return syncAllCoachSummaries(db);
}
