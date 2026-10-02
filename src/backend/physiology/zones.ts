import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import type { ActivityRecord } from '../ingestion/csv-parser';
import { MAX_OBSERVED_GAP_SECONDS } from './time-series.js';

export interface HeartRateZones {
  z1: [number, number]; // Recovery (< 68% HRmax or < LT1 - 15)
  z2: [number, number]; // Aerobic Base / Up to LT1
  z3: [number, number]; // Tempo (Between LT1 and LT2)
  z4: [number, number]; // Threshold / LT2
  z5: [number, number]; // Above LT2
}

export interface ZoneDistribution {
  z1Seconds: number;
  z2Seconds: number;
  z3Seconds: number;
  z4Seconds: number;
  z5Seconds: number;
  z1Pct: number;
  z2Pct: number;
  z3Pct: number;
  z4Pct: number;
  z5Pct: number;
}

export const LT2_TRAINING_BAND_TOLERANCE_BPM = 4;

export function getLt2TrainingBand(lt2Hr: number): [number, number] {
  return [
    Math.max(1, lt2Hr - LT2_TRAINING_BAND_TOLERANCE_BPM),
    lt2Hr + LT2_TRAINING_BAND_TOLERANCE_BPM
  ];
}

export function getDefaultZones(
  maxHr?: number,
  lt1Hr?: number,
  lt2Hr?: number,
  restingHr?: number
): HeartRateZones {
  const resolved = resolveHeartRateProfile({ maxHr, restingHr, lt1Hr, lt2Hr });
  const { restingHr: rhr, lt1Hr: lt1, lt2Hr: lt2 } = resolved;
  maxHr = resolved.maxHr;

  // HRR Zone 1 active recovery ceiling (~54% HRR, bounded below LT1 - 14)
  const z1Upper = Math.min(lt1 - 14, Math.round(rhr + (maxHr - rhr) * 0.54));
  // Split the broad LT1-to-LT2 range at 80% HRR. Keep the upper Zone 4 / Zone
  // 5 boundary tied to the high-intensity HRR anchor, while ensuring Zone 5
  // never starts at or below the athlete's LT2 estimate.
  const z3Upper = Math.max(lt1 + 1, Math.min(lt2 - 1, Math.round(rhr + (maxHr - rhr) * 0.80)));
  const z5Lower = Math.max(lt2 + 1, Math.round(rhr + (maxHr - rhr) * 0.90));

  return {
    z1: [0, z1Upper],
    z2: [z1Upper + 1, lt1],
    z3: [lt1 + 1, z3Upper],
    z4: [z3Upper + 1, z5Lower - 1],
    z5: [z5Lower, Math.max(maxHr + 10, z5Lower + 15)]
  };
}

export function calculateZoneDistribution(records: ActivityRecord[], zones: HeartRateZones): ZoneDistribution {
  let z1 = 0, z2 = 0, z3 = 0, z4 = 0, z5 = 0;
  let total = 0;

  for (let index = 0; index < records.length; index++) {
    const r = records[index];
    const hr = r.heartRate;
    if (!hr || !Number.isFinite(hr) || hr <= 40 || hr > 240) continue;
    const seconds = recordDurationSeconds(records, index);

    total += seconds;
    if (hr <= zones.z1[1]) {
      z1 += seconds;
    } else if (hr <= zones.z2[1]) {
      z2 += seconds;
    } else if (hr <= zones.z3[1]) {
      z3 += seconds;
    } else if (hr <= zones.z4[1]) {
      z4 += seconds;
    } else {
      z5 += seconds;
    }
  }

  return {
    z1Seconds: z1,
    z2Seconds: z2,
    z3Seconds: z3,
    z4Seconds: z4,
    z5Seconds: z5,
    z1Pct: total > 0 ? Number(((z1 / total) * 100).toFixed(1)) : 0,
    z2Pct: total > 0 ? Number(((z2 / total) * 100).toFixed(1)) : 0,
    z3Pct: total > 0 ? Number(((z3 / total) * 100).toFixed(1)) : 0,
    z4Pct: total > 0 ? Number(((z4 / total) * 100).toFixed(1)) : 0,
    z5Pct: total > 0 ? Number(((z5 / total) * 100).toFixed(1)) : 0
  };
}

/** Smart recording samples represent elapsed time, rather than one second each.
 * Long gaps have no usable intensity evidence. The final sample uses the last
 * recording interval, or one second when that interval is unavailable.
 */
export function recordDurationSeconds(records: Pick<ActivityRecord, 'elapsedSeconds'>[], index: number): number {
  const current = records[index].elapsedSeconds;
  const next = records[index + 1]?.elapsedSeconds;
  const seconds = next == null ? current - (records[index - 1]?.elapsedSeconds ?? current - 1) : next - current;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_OBSERVED_GAP_SECONDS) return next == null ? 1 : 0;
  return seconds;
}
