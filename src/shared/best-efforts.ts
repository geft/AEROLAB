/**
 * Wire contracts for GET /api/activities/best-efforts.
 */

/** One tracked benchmark distance. */
export interface BestEffortTarget {
  id: string;
  label: string;
  distanceMeters: number;
}

/** A personal best effort over a benchmark distance. */
export interface BestEffortRecord {
  /** Missing only in older offline snapshots. */
  source?: 'measured' | 'estimated';
  targetId: string;
  label: string;
  distanceMeters: number;
  timeSeconds: number;
  paceSecKm: number;
  activityId: string;
  activityName: string;
  activityDate: string;
}

/** GET /api/activities/best-efforts */
export interface BestEffortsReport {
  allTime: BestEffortRecord[];
  currentYear: BestEffortRecord[];
  targets: BestEffortTarget[];
}
