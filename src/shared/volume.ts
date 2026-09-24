/**
 * Wire contracts for the volume and longitudinal progress endpoints.
 * Declared here so both the backend services and the frontend agree on the shape.
 */

/** A single heart-rate zone bucket in the volume summary. */
export interface VolumeZoneBucket {
  hours: number;
  pct: number;
}

/** Heart-rate zone accumulation across the selected period. */
export interface VolumeZones {
  z1: VolumeZoneBucket;
  z2: VolumeZoneBucket;
  z3: VolumeZoneBucket;
  z4: VolumeZoneBucket;
  z5: VolumeZoneBucket;
  z2Hours: number;
  z2Pct: number;
  z3Hours: number;
  z3Pct: number;
  z4Hours: number;
  z4Pct: number;
  z5Hours: number;
  z5Pct: number;
}

/** Query parameters accepted by GET /api/activities/volume. */
export interface VolumeQuery {
  period?: string;
  month?: string;
  year?: string;
}

/** GET /api/activities/volume */
export interface VolumeSummary {
  period: string;
  periodLabel: string;
  count: number;
  activityCount: number;
  distanceKm: number;
  totalDistanceKm: number;
  durationHours: number;
  totalDurationHours: number;
  elevationGainM: number;
  totalElevationGainM: number;
  avgEf: number | null;
  zones: VolumeZones;
}

/** A threshold calibration row attached to a monthly/yearly progress bucket. */
export interface ProgressCalibration {
  effective_date?: string | null;
  [key: string]: unknown;
}

/** One monthly bucket of GET /api/activities/progress-history. */
export interface ProgressHistoryMonth {
  period: string;
  label: string;
  runCount: number;
  totalDistanceKm: number;
  totalDurationHours: number;
  totalElevationM: number;
  avgEfficiencyFactor: number | null;
  avgPaceSecKm: number | null;
  avgHeartRate: number | null;
  zone2Hours: number;
  zone2Pct: number;
  calibrations: ProgressCalibration[];
}

/** One yearly bucket of GET /api/activities/progress-history. */
export interface ProgressHistoryYear {
  period: string;
  label: string;
  runCount: number;
  activeMonths: number;
  totalDistanceKm: number;
  totalDurationHours: number;
  totalElevationM: number;
  avgEfficiencyFactor: number | null;
  avgPaceSecKm: number | null;
  avgHeartRate: number | null;
  calibrations: ProgressCalibration[];
}

/** GET /api/activities/progress-history */
export interface ProgressHistoryResponse {
  months: ProgressHistoryMonth[];
  years: ProgressHistoryYear[];
}
