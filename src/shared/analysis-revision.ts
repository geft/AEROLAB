/** Bump when a persisted analysis policy changes; upgrades refresh history once. */
export const ANALYSIS_REVISION = 'classification-telemetry-v1';
export interface AnalysisFreshness {
  revision: string | null;
  status: 'fresh' | 'stale' | 'missing' | 'updating';
}

export interface AnalysisProvenance {
  revision: string;
  workoutStartTime: string;
  historicalProfile: { maxHr: number; restingHr: number; lt1Hr: number; lt2Hr: number };
  telemetryPolicy: 'fit-timer-and-observed-gaps-v1';
}

export function parseAnalysisProvenance(value: unknown): AnalysisProvenance | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.revision !== 'string' || typeof row.workoutStartTime !== 'string' || row.telemetryPolicy !== 'fit-timer-and-observed-gaps-v1'
    || !row.historicalProfile || typeof row.historicalProfile !== 'object' || Array.isArray(row.historicalProfile)) return undefined;
  const profile = row.historicalProfile as Record<string, unknown>;
  if (!['maxHr', 'restingHr', 'lt1Hr', 'lt2Hr'].every(key => typeof profile[key] === 'number' && Number.isFinite(profile[key]))) return undefined;
  return row as unknown as AnalysisProvenance;
}
