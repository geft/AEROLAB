import type Database from 'better-sqlite3';
import { withAnalysisRecordCache } from '../../db/analysis-records.js';
import { withAerobicEvidenceSnapshot } from '../../physiology/aerobic-assessment.js';

/**
 * Batch scope for a replay or recalibration pass.
 *
 * Every derived metric is recomputed from telemetry these passes never write, so
 * decoded records and aerobic observations are reused instead of being rebuilt
 * for each activity. Both caches are bounded and released at the scope exit.
 */
export function withDerivedAnalysisBatch<T>(db: Database.Database, action: () => T): T {
  return withAnalysisRecordCache(db, () => withAerobicEvidenceSnapshot(db, action));
}
