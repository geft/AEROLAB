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

/**
 * Calculates race predictions based on LT2 (threshold pace), LT1 (aerobic base),
 * and proven benchmark performance (such as 5k time trial / PB).
 */
export function calculateRacePredictions(
  lt2PaceSecKm: number | null,
  lt1PaceSecKm: number | null,
  fallbackPaceSecKm: number = 330, // default 5:30/km
  benchmark5kPaceSecKm?: number | null
): { predictions: RacePrediction[]; vo2Max: number } {
  // If benchmark 5K pace is provided (e.g. 273 s/km / 22:48 5K Time Trial),
  // calibrate threshold pace (~5.5% slower than 5K pace)
  const benchmarkThreshold = benchmark5kPaceSecKm ? Math.round(benchmark5kPaceSecKm * 1.055) : null;

  // Effective threshold pace: prioritize proven LT2 or benchmark over conservative aerobic base fallback
  let thresholdPace = lt2PaceSecKm || benchmarkThreshold || (lt1PaceSecKm ? lt1PaceSecKm * 0.88 : fallbackPaceSecKm * 0.9);
  if (benchmarkThreshold && thresholdPace > benchmarkThreshold) {
    thresholdPace = benchmarkThreshold;
  }

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
    if (d.name === '5K' && benchmark5kPaceSecKm && paceSecKm > benchmark5kPaceSecKm) {
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

  return { predictions, vo2Max: estimatedVo2Max };
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
