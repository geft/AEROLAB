export interface ThresholdObservation {
  hr: number;
  pace: number | null;
  confidence: number;
  effective_date: string;
}

export const thresholdTime = (date: string) => new Date(date.replace(' ', 'T')).getTime();

/** Causal estimate: only observations available at the requested date contribute. */
export function rollingThreshold(observations: ThresholdObservation[], asOfDate: string,
  options: { strictlyBefore?: boolean } = {}) {
  const refTime = thresholdTime(asOfDate);
  if (!Number.isFinite(refTime)) return null;
  // Parse each date once; rejected evidence must not displace a usable observation
  // from the recent-five / historical-three selection window.
  const eligible = observations.map(row => ({ row, time: thresholdTime(row.effective_date) }))
    .filter(({ row, time }) => Number.isFinite(time) && (options.strictlyBefore ? time < refTime : time <= refTime) &&
      Number.isFinite(row.hr) && row.hr > 0 && Number.isFinite(row.confidence) && row.confidence > 0 && row.confidence <= 1)
    .sort((a, b) => b.time - a.time);
  const recent = eligible.filter(({ time }) => refTime - time <= 45 * 86400000);
  const rows = recent.length ? recent.slice(0, 5) : eligible.slice(0, 3);
  if (!rows.length) return null;
  let weightSum = 0, hrSum = 0, paceWeight = 0, paceSum = 0, confidenceSum = 0;
  for (const { row, time } of rows) {
    const daysAgo = Math.max(0, (refTime - time) / 86400000);
    const confidence = row.confidence;
    const weight = confidence * Math.max(0.25, 1 - daysAgo / 45);
    weightSum += weight;
    hrSum += row.hr * weight;
    confidenceSum += confidence * weight;
    if (row.pace != null && Number.isFinite(row.pace) && row.pace > 0) {
      paceWeight += weight;
      paceSum += row.pace * weight;
    }
  }
  return {
    hr: Math.round(hrSum / weightSum),
    pace: paceWeight ? Math.round(paceSum / paceWeight) : null,
    confidence: Number((confidenceSum / weightSum).toFixed(2)),
    latestDate: rows[0].row.effective_date
  };
}
