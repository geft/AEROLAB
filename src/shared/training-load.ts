/**
 * Wire contract for GET /api/activities/training-load. Mirrors the physiological
 * training status payload so the route can be a thin response mapper.
 */
export type TrainingStatusType =
  | 'optimal'
  | 'recovery'
  | 'overreaching'
  | 'very_high'
  | 'maintaining'
  | 'establishing';

export interface DayLoadPoint {
  date: string;
  dailyLoad: number;
  acuteLoad: number;
  chronicLoad: number;
  optimalMin: number;
  optimalMax: number;
  acwr: number;
}

export interface TrainingStatusResult {
  currentAcuteLoad: number;
  currentChronicLoad: number;
  acwr: number;
  status: TrainingStatusType;
  statusLabel: string;
  statusDescription: string;
  optimalRange: {
    min: number;
    max: number;
  };
  last7DaysLoad: number;
  timeline: DayLoadPoint[];
}

/** GET /api/activities/training-load */
export interface TrainingLoadResponse {
  trainingStatus: TrainingStatusResult;
}
