export interface ThresholdObservation {
  hr: number;
  pace: number | null;
  confidence: number;
  effective_date: string;
}

export const thresholdTime = (date: string) => new Date(date.replace(' ', 'T')).getTime();

/** Causal estimate: only observations available at the requested date contribute. */
export function rollingThreshold(observations: ThresholdObservation[], asOfDate: string) {
  const refTime = thresholdTime(asOfDate);
  const eligible = observations.filter(r => thresholdTime(r.effective_date) <= refTime)
    .sort((a, b) => thresholdTime(b.effective_date) - thresholdTime(a.effective_date));
  const recent = eligible.filter(r => refTime - thresholdTime(r.effective_date) <= 45 * 86400000);
  const rows = recent.length ? recent.slice(0, 5) : eligible.slice(0, 3);
  if (!rows.length) return null;
  let weightSum = 0, hrSum = 0, paceWeight = 0, paceSum = 0, confidenceSum = 0;
  for (const row of rows) {
    const daysAgo = Math.max(0, (refTime - thresholdTime(row.effective_date)) / 86400000);
    const confidence = row.confidence || 0.85;
    const weight = confidence * Math.max(0.25, 1 - daysAgo / 45);
    weightSum += weight;
    hrSum += row.hr * weight;
    confidenceSum += confidence * weight;
    if (row.pace && row.pace > 0) {
      paceWeight += weight;
      paceSum += row.pace * weight;
    }
  }
  return {
    hr: Math.round(hrSum / weightSum),
    pace: paceWeight ? Math.round(paceSum / paceWeight) : null,
    confidence: Number((confidenceSum / weightSum).toFixed(2)),
    latestDate: rows[0].effective_date
  };
}
