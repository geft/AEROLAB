import data from './confirmed-runs.json';
import type { ActivityMetadata, ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';
import type { RunType } from '../../src/backend/ingestion/classifier.js';

/** Actual sparse telemetry, not a synthetic trace fitted to the expected label.
 * See docs/CONFIRMED_RUNS.md for intent, known automatic misses and usage.
 */
export const CONFIRMED_PROFILE = data.profile;
export const CONFIRMED_RUNS = data.runs.map(run => ({
  ...run,
  expectedRunType: run.expectedRunType as RunType,
  metadata: run.metadata as ActivityMetadata,
  records: run.rows.map(([elapsedSeconds, heartRate, cadence, speedMps, distanceMeters, stanceTime, verticalOscillation]) => ({
    elapsedSeconds, heartRate, cadence, speedMps, distanceMeters, stanceTime, verticalOscillation,
    timestamp: `${run.date}+${elapsedSeconds}s`,
    altitudeMeters: null, latitude: null, longitude: null, temperature: null
  } as ActivityRecord))
}));
