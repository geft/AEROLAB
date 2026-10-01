export interface RacePrediction {
  distanceName: string;
  distanceKm: number;
  timeSeconds: number;
  timeFormatted: string;
  paceSecKm: number;
  paceFormatted: string;
}

export interface PhysiologicalStatus {
  lt1PaceSecKm: number | null;
  lt1Hr: number | null;
  lt2PaceSecKm: number | null;
  lt2Hr: number | null;
  estimatedVo2Max: number | null;
  baselineEconomyEf: number | null;
  predictions: RacePrediction[];
}

export interface RaceBenchmark {
  paceSecKm: number;
  date: string | null;
  source: 'race_segment' | 'race_activity' | 'profile_pb';
  activityId?: string;
}
export interface PredictionEvidence {
  source: 'lt2' | 'benchmark_5k' | 'lt1' | 'recent_runs' | null;
  thresholdPaceSecKm: number | null;
  benchmark: RaceBenchmark | null;
  benchmarkUsed: boolean;
}
// Evidence policy, not a physiological pace-decay model.
export const BENCHMARK_FRESHNESS_DAYS = 90;
const validPace = (pace: number | null | undefined): pace is number => pace != null && Number.isFinite(pace) && pace > 0;
const dateTime = (date: string | null | undefined) => date ? new Date(date.replace(' ', 'T')).getTime() : NaN;
export function isFreshPredictionEvidence(date: string | null | undefined, asOf: Date): boolean {
  const ageDays = (asOf.getTime() - dateTime(date)) / 86400000;
  return Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= BENCHMARK_FRESHNESS_DAYS;
}

/**
 * Calculates race predictions based on LT2 (threshold pace), LT1 (aerobic base),
 * and proven benchmark performance (such as 5k time trial / PB).
 */
export function calculateRacePredictions(
  lt2PaceSecKm: number | null,
  lt1PaceSecKm: number | null,
  fallbackPaceSecKm: number | null = null,
  benchmarkInput?: RaceBenchmark | number | null,
  options: { asOf?: Date; lt2EffectiveDate?: string | null; lt2IsEstimated?: boolean; lt2EstimateSource?: 'lt1' | 'recent_runs' } = {}
): { predictions: RacePrediction[]; vo2Max: number | null; evidence: PredictionEvidence } {
  lt2PaceSecKm = validPace(lt2PaceSecKm) ? lt2PaceSecKm : null;
  lt1PaceSecKm = validPace(lt1PaceSecKm) ? lt1PaceSecKm : null;
  fallbackPaceSecKm = validPace(fallbackPaceSecKm) ? fallbackPaceSecKm : null;
  const benchmark = typeof benchmarkInput === 'number'
    ? { paceSecKm: benchmarkInput, date: null, source: 'profile_pb' as const }
    : benchmarkInput ?? null;
  const benchmarkTime = dateTime(benchmark?.date);
  const fresh = isFreshPredictionEvidence(benchmark?.date, options.asOf ?? new Date());
  const lt2Time = dateTime(options.lt2EffectiveDate);
  const measuredLt2 = lt2PaceSecKm != null && !options.lt2IsEstimated;
  // An undated PB can seed an estimate, but cannot replace calibrated LT2.
  // Dated older evidence cannot overrule a more recent calibration.
  const usableBenchmark = benchmark && validPace(benchmark.paceSecKm) &&
    ((fresh && (!measuredLt2 || (Number.isFinite(lt2Time) && benchmarkTime >= lt2Time))) ||
      (benchmark.date == null && !measuredLt2)) ? benchmark : null;
  const benchmark5kPaceSecKm = usableBenchmark?.paceSecKm ?? null;
  // If benchmark 5K pace is provided (e.g. 273 s/km / 22:48 5K Time Trial),
  // calibrate threshold pace (~5.5% slower than 5K pace)
  const benchmarkThreshold = benchmark5kPaceSecKm ? Math.round(benchmark5kPaceSecKm * 1.055) : null;

  // Effective threshold pace: prioritize proven LT2 or benchmark over conservative aerobic base fallback
  let source: PredictionEvidence['source'] = lt2PaceSecKm
    ? (options.lt2IsEstimated ? options.lt2EstimateSource ?? 'lt1' : 'lt2')
    : benchmarkThreshold ? 'benchmark_5k' : lt1PaceSecKm ? 'lt1' : fallbackPaceSecKm ? 'recent_runs' : null;
  let thresholdPace = lt2PaceSecKm || benchmarkThreshold || (lt1PaceSecKm ? lt1PaceSecKm * 0.88 : (fallbackPaceSecKm || 0) * 0.9);
  if (benchmarkThreshold && (thresholdPace > benchmarkThreshold || options.lt2IsEstimated)) {
    thresholdPace = benchmarkThreshold;
    source = 'benchmark_5k';
  }
  const evidence: PredictionEvidence = { source, thresholdPaceSecKm: thresholdPace || null,
    benchmark, benchmarkUsed: source === 'benchmark_5k' };
  if (!source || !validPace(thresholdPace)) return { predictions: [], vo2Max: null, evidence };

  // VDOT / VO2max estimate from threshold pace (approximate Jack Daniels formula)
  const vMpm = (1000 / thresholdPace) * 60;
  const rawVo2 = -4.6 + 0.182258 * vMpm + 0.000104 * Math.pow(vMpm, 2);
  const estimatedVo2Max = Number(Math.max(15, Math.min(85, rawVo2 / 0.88)).toFixed(1));

  // Ratios relative to LT2 threshold pace:
  // 5K: ~5% faster than LT2
  // 10K: ~1% faster or equal to LT2
  // Half Marathon: ~5% slower than LT2
  // Marathon: ~14% slower than LT2 (aerobically bounded)
  const distances = [
    { name: '5K', km: 5.0, factor: 0.947 },
    { name: '10K', km: 10.0, factor: 0.995 },
    { name: 'Half Marathon', km: 21.0975, factor: 1.055 },
    { name: 'Marathon', km: 42.195, factor: 1.15 }
  ];

  const predictions: RacePrediction[] = distances.map(d => {
    let paceSecKm = Math.round(thresholdPace * d.factor);
    if (d.name === '5K' && evidence.benchmarkUsed && benchmark5kPaceSecKm && paceSecKm > benchmark5kPaceSecKm) {
      paceSecKm = benchmark5kPaceSecKm;
    }
    const totalSec = Math.round(paceSecKm * d.km);

    return {
      distanceName: d.name,
      distanceKm: d.km,
      timeSeconds: totalSec,
      timeFormatted: formatDuration(totalSec),
      paceSecKm,
      paceFormatted: formatPace(paceSecKm)
    };
  });

  return { predictions, vo2Max: estimatedVo2Max, evidence };
}

export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatPace(secKm: number): string {
  const mins = Math.floor(secKm / 60);
  const secs = Math.round(secKm % 60);
  return `${mins}:${String(secs).padStart(2, '0')}/km`;
}
