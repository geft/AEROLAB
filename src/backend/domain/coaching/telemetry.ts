/** Compatibility inputs are converted here; calculations use one camelCase shape. */
export interface CoachingRecord {
  elapsedSeconds: number;
  heartRate: number | null;
  cadence: number | null;
  distanceMeters: number | null;
  altitudeMeters: number | null;
  timerActive?: boolean;
  timerSegment?: number;
}
export type CoachingRecordInput = Partial<CoachingRecord> & {
  elapsed_seconds?: number | null; heart_rate?: number | null; cad?: number | null;
  distance_m?: number | null; altitude_m?: number | null;
};
export interface CoachingInterval {
  type: string;
  startSeconds: number;
  durationSeconds: number;
  avgHeartRate: number;
  maxHeartRate: number;
  avgPaceSecKm: number | null;
  avgSpeedMps: number | null;
  hrDrop: number;
}
export type CoachingIntervalInput = { [K in keyof CoachingInterval]?: CoachingInterval[K] | null } & {
  intervalIndex?: number; interval_index?: number; distanceMeters?: number | null; distance_meters?: number | null;
  start_seconds?: number | null; duration_seconds?: number | null;
  avg_heart_rate?: number | null; max_heart_rate?: number | null; avg_pace_sec_km?: number | null;
  avg_speed_mps?: number | null; hr_drop?: number | null;
};
export interface CoachingSplit { durationSeconds: number; avgPaceSecKm: number | null }
export type CoachingSplitInput = Partial<CoachingSplit> & { split_index?: number; splitIndex?: number; distanceMeters?: number | null; distance_meters?: number | null; duration_seconds?: number | null; avg_pace_sec_km?: number | null };

const sensor = (value: number | null | undefined): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const coachingRecord = (record: CoachingRecordInput, index = 0): CoachingRecord => ({
  elapsedSeconds: sensor(record.elapsedSeconds ?? record.elapsed_seconds) ?? index,
  heartRate: sensor(record.heartRate ?? record.heart_rate), cadence: sensor(record.cadence ?? record.cad),
  distanceMeters: sensor(record.distanceMeters ?? record.distance_m), altitudeMeters: sensor(record.altitudeMeters ?? record.altitude_m),
  timerActive: record.timerActive, timerSegment: record.timerSegment
});
export const coachingInterval = (rep: CoachingIntervalInput): CoachingInterval => ({
  type: rep.type ?? '', startSeconds: sensor(rep.startSeconds ?? rep.start_seconds) ?? 0,
  durationSeconds: sensor(rep.durationSeconds ?? rep.duration_seconds) ?? 0,
  avgHeartRate: sensor(rep.avgHeartRate ?? rep.avg_heart_rate) ?? 0,
  maxHeartRate: sensor(rep.maxHeartRate ?? rep.max_heart_rate) ?? 0,
  avgPaceSecKm: sensor(rep.avgPaceSecKm ?? rep.avg_pace_sec_km),
  avgSpeedMps: sensor(rep.avgSpeedMps ?? rep.avg_speed_mps), hrDrop: sensor(rep.hrDrop ?? rep.hr_drop) ?? 0
});
export const coachingSplit = (split: CoachingSplitInput): CoachingSplit => ({
  durationSeconds: sensor(split.durationSeconds ?? split.duration_seconds) ?? 0,
  avgPaceSecKm: sensor(split.avgPaceSecKm ?? split.avg_pace_sec_km)
});
