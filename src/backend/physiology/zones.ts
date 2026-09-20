import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { ActivityRecord } from '../ingestion/csv-parser';

export interface HeartRateZones {
  z1: [number, number]; // Recovery (< 68% HRmax or < LT1 - 15)
  z2: [number, number]; // Aerobic Base / Up to LT1
  z3: [number, number]; // Tempo (Between LT1 and LT2)
  z4: [number, number]; // Threshold / LT2
  z5: [number, number]; // VO2 Max / Anaerobic (> LT2)
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
  // HRR Zone 4 threshold ceiling: 90% HRR, at or above LT2
  const z4Upper = Math.min(maxHr - 1, Math.max(lt2, Math.round(rhr + (maxHr - rhr) * 0.90)));

  return {
    z1: [0, z1Upper],
    z2: [z1Upper + 1, lt1],
    z3: [lt1 + 1, lt2 - 1],
    z4: [lt2, z4Upper],
    z5: [z4Upper + 1, Math.max(maxHr + 10, z4Upper + 15)]
  };
}

export function calculateZoneDistribution(records: ActivityRecord[], zones: HeartRateZones): ZoneDistribution {
  let z1 = 0, z2 = 0, z3 = 0, z4 = 0, z5 = 0;
  let total = 0;

  for (const r of records) {
    const hr = r.heartRate;
    if (!hr || hr <= 40) continue;

    total++;
    if (hr <= zones.z1[1]) {
      z1++;
    } else if (hr <= zones.z2[1]) {
      z2++;
    } else if (hr <= zones.z3[1]) {
      z3++;
    } else if (hr <= zones.z4[1]) {
      z4++;
    } else {
      z5++;
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
