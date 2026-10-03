/** Normalized workout input, independent of CSV/FIT parsing and SQLite storage. */
export interface ActivityMetadata {
  id: string;
  name: string;
  date: string;
  sport: string;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  totalElapsedSeconds: number;
  avgHeartRate: number;
  maxHeartRate: number;
  avgCadence: number;
  maxCadence: number;
  calories: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
}

export interface ActivityRecord {
  /** Analysis-only timer state; never persisted over raw telemetry. */
  timerActive?: boolean;
  timerSegment?: number;
  timerPauseSeconds?: number;
  timestamp: string;
  elapsedSeconds: number;
  heartRate: number | null;
  cadence: number | null;
  speedMps: number | null;
  distanceMeters: number | null;
  altitudeMeters: number | null;
  latitude: number | null;
  longitude: number | null;
  temperature: number | null;
  verticalOscillation: number | null;
  stanceTime: number | null;
  stepLength?: number | null;
  fractionalCadence?: number | null;
  power?: number | null;
  verticalRatio?: number | null;
  stanceTimeBalance?: number | null;
  respirationRate?: number | null;
  coreTemperature?: number | null;
  fitFields?: Record<string, unknown>;
}
