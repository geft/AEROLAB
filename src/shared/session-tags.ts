/** A session has one classification plus detected structural or terrain tags. */
export const RUN_TYPE_LABELS: Record<string, string> = {
  easy_base: 'Easy Base', long_run: 'Long Run', recovery: 'Recovery',
  threshold_lt2: 'Threshold', intervals_vo2: 'VO2 Max', tempo: 'Tempo', race: 'Race'
};

export interface ElevationEvidence {
  distance_meters?: number | null;
  elevation_gain_m?: number | null;
  elevation_loss_m?: number | null;
}

// Product cutoffs: require meaningful vertical travel and scale it to route length.
export const HILLS_MIN_VERTICAL_METERS = 50;
export const HILLS_MIN_VERTICAL_METERS_PER_KM = 30;

export function hasHills(evidence: ElevationEvidence): boolean {
  const distance = evidence.distance_meters;
  if (distance == null || !Number.isFinite(distance) || distance <= 0) return false;
  const gain = evidence.elevation_gain_m ?? 0;
  const loss = evidence.elevation_loss_m ?? 0;
  if (!Number.isFinite(gain) || !Number.isFinite(loss) || gain < 0 || loss < 0) return false;
  const vertical = gain + loss;
  return vertical >= HILLS_MIN_VERTICAL_METERS &&
    vertical / (distance / 1000) >= HILLS_MIN_VERTICAL_METERS_PER_KM;
}

export function sessionTags(
  runType: string | null | undefined, tags: readonly string[], elevation: ElevationEvidence = {}
): string[] {
  const label = RUN_TYPE_LABELS[runType || ''];
  return [...(label ? [label] : []),
    ...(tags.some(tag => tag.toLowerCase() === 'strides') ? ['Strides'] : []),
    ...(hasHills(elevation) ? ['Hills'] : [])];
}
