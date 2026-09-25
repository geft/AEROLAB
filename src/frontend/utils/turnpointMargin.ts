export type TurnpointMarginTier = 'optimal' | 'well' | 'base';

const OPTIMAL_MARGIN_MAX_SECONDS = 50;
const WELL_CONDITIONED_MARGIN_MAX_SECONDS = 70;
const LT1_ONLY_MARGIN_ESTIMATE_RATIO = 0.14;

export function classifyTurnpointMargin(gapSeconds: number): TurnpointMarginTier {
  if (gapSeconds <= OPTIMAL_MARGIN_MAX_SECONDS) return 'optimal';
  if (gapSeconds <= WELL_CONDITIONED_MARGIN_MAX_SECONDS) return 'well';
  return 'base';
}

export function estimateTurnpointGapSeconds(lt1PaceSecKm: number | null | undefined): number | null {
  return lt1PaceSecKm ? Math.round(lt1PaceSecKm * LT1_ONLY_MARGIN_ESTIMATE_RATIO) : null;
}
