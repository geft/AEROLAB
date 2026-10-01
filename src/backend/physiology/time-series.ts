/** Adjacent observed intervals only. Never infer evidence across recording gaps. */
export const MAX_OBSERVED_GAP_SECONDS = 15;

export function observedIntervals<T>(records: T[], time: (record: T) => number) {
  const intervals: Array<{ a: T; b: T; from: number; to: number; seconds: number }> = [];
  for (let i = 1; i < records.length; i++) {
    const a = records[i - 1], b = records[i];
    const from = time(a), to = time(b), seconds = to - from;
    if (Number.isFinite(from) && Number.isFinite(to) && seconds > 0 && seconds <= MAX_OBSERVED_GAP_SECONDS) {
      intervals.push({ a, b, from, to, seconds });
    }
  }
  return intervals;
}

export function timeWeightedMean<T>(records: T[], time: (record: T) => number,
  value: (record: T) => number | null | undefined,
  valid: (value: number) => boolean = value => value > 0,
  from = -Infinity, to = Infinity): number | null {
  let sum = 0, duration = 0;
  for (const interval of observedIntervals(records, time)) {
    const a = value(interval.a), b = value(interval.b);
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || !valid(a) || !valid(b)) continue;
    const start = Math.max(from, interval.from), end = Math.min(to, interval.to);
    if (end <= start) continue;
    const interpolate = (at: number) => a + (b - a) * (at - interval.from) / interval.seconds;
    sum += (interpolate(start) + interpolate(end)) / 2 * (end - start);
    duration += end - start;
  }
  return duration > 0 ? sum / duration : null;
}

export function observedDuration<T>(records: T[], time: (record: T) => number,
  valid: (record: T) => boolean = () => true, from = -Infinity, to = Infinity): number {
  return observedIntervals(records, time).reduce((sum, i) => sum + (valid(i.a) && valid(i.b)
    ? Math.max(0, Math.min(to, i.to) - Math.max(from, i.from)) : 0), 0);
}

/** Time-weighted empirical distribution; a sample describes its following interval. */
export function timeDistribution<T>(records: T[], time: (record: T) => number,
  value: (record: T) => number | null | undefined, valid: (value: number) => boolean) {
  const evidence = observedIntervals(records, time).flatMap(({ a, seconds }) => {
    const v = value(a);
    return v != null && Number.isFinite(v) && valid(v) ? [{ value: v, seconds }] : [];
  }).sort((a, b) => a.value - b.value);
  const seconds = evidence.reduce((sum, item) => sum + item.seconds, 0);
  return { seconds, quantile: (fraction: number) => {
    let elapsed = 0;
    for (const item of evidence) {
      elapsed += item.seconds;
      if (elapsed > seconds * fraction) return item.value;
    }
    return evidence.at(-1)?.value ?? 0;
  } };
}
