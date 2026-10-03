import type { SnapshotDocument } from '../../src/shared/snapshot-codec.js';

export function snapshotFixture(): SnapshotDocument {
  const activity = { id: 'run-1', start_time: '2026-09-01T07:00:00Z', name: 'Easy run', weather_source: 'manual', avg_heart_rate: 140 };
  return {
    schemaVersion: 2, generatedAt: '2026-10-03T00:00:00Z', activities: [activity],
    details: { 'run-1': {
      activity: { id: activity.id, start_time: activity.start_time, name: 'Detailed run', avg_heart_rate: 145 },
      records: [
        { id: 100, activity_id: 'run-1', timestamp: activity.start_time, elapsed_seconds: 0, heart_rate: null, speed_mps: 2.1234567891011, altitude_m: 8.800000000000011, distance_m: 0, cadence: 180, temp: 31 },
        { id: 101, activity_id: 'run-1', timestamp: activity.start_time, elapsed_seconds: 30, heart_rate: 150, speed_mps: 3.1234567891011, altitude_m: null, distance_m: 90.1234567891011, cadence: 181, temp: 32 },
      ],
      splits: [{ split_index: 1, avg_heart_rate: 145 }], intervals: [{ type: 'stride', start_seconds: 10, duration_seconds: 15 }],
      coachSummary: { headline: '稳定跑步', effectivenessScore: 90 }, fitMetadata: { exportOnly: true },
      heartRateThresholds: { lt1Hr: 140, lt2Hr: 170 }, pauseBreakdown: {},
    } },
    profile: { profile: { id: 'primary' }, isConfigured: true }, bestEfforts: {}, progressByRunType: {},
    thresholdsByRunType: {}, volume: {}, trainingLoadByDays: {},
  };
}
