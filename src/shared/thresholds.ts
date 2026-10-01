/**
 * Wire contracts for GET /api/thresholds (and the shared heart-rate profile
 * shapes reused by the profile endpoint).
 */

/** Heart-rate zone boundaries, each a [min, max] pair. */
export interface HeartRateZones {
  z1: [number, number];
  z2: [number, number];
  z3: [number, number];
  z4: [number, number];
  z5: [number, number];
}

/** The athlete's currently effective threshold values. */
export interface CurrentThresholds {
  lt1Hr: number;
  lt2Hr: number;
  lt1Range: [number, number];
  lt1PaceSecKm: number | null;
  lt2PaceSecKm: number | null;
  baselineEconomyEf: number | null;
  confidence: number;
  source: 'calibrated' | 'baseline';
  lastCalibratedDate: string | null;
}

/** A row from the calibration history (physiological_thresholds). */
export interface CalibrationHistoryItem {
  id?: number;
  effective_date?: string | null;
  source_activity_id?: string | null;
  activity_name?: string | null;
  activity_run_type?: string | null;
  lt1_hr?: number | null;
  lt1_pace_sec_km?: number | null;
  lt2_hr?: number | null;
  lt2_pace_sec_km?: number | null;
  baseline_economy_ef?: number | null;
  confidence?: number | null;
  is_estimated?: boolean | null;
  notes?: string | null;
  distance_meters?: number | null;
  duration_seconds?: number | null;
  [key: string]: unknown;
}

/** Latest calibrated LT1/LT2 plus the derived VO2 max. */
export interface ThresholdsLatest {
  lt1: CalibrationHistoryItem | null;
  lt2: CalibrationHistoryItem | null;
  vo2Max: number | null;
}

/** A single race-time prediction. */
export interface RacePrediction {
  distanceName: string;
  distanceKm: number;
  timeSeconds: number;
  timeFormatted: string;
  paceSecKm: number;
  paceFormatted: string;
}

/** One point of the pace-dependent economy timeline. */
export interface EconomyTrendPoint {
  id: string;
  start_time: string;
  name?: string | null;
  run_type?: string | null;
  efficiency_factor: number | null;
  meters_per_beat?: number | null;
  aerobic_decoupling_pct?: number | null;
  avg_pace_sec_km?: number | null;
  avg_heart_rate?: number | null;
  [key: string]: unknown;
}

/** One pace/HR scatter point for the efficiency curve. */
export interface ScatterPoint {
  id: string;
  start_time: string;
  name?: string | null;
  run_type?: string | null;
  avg_pace_sec_km: number | null;
  avg_heart_rate: number | null;
  efficiency_factor: number | null;
  meters_per_beat?: number | null;
  [key: string]: unknown;
}

/** GET /api/thresholds */
export interface ThresholdsResponse {
  latest: ThresholdsLatest;
  currentThresholds: CurrentThresholds;
  zones: HeartRateZones;
  predictions: RacePrediction[];
  history: CalibrationHistoryItem[];
  economyTrend: EconomyTrendPoint[];
  scatterData: ScatterPoint[];
}
