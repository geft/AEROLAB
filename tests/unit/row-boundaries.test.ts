import { describe, expect, it } from 'vitest';
import { activityFromRow, coachSummaryFromRow, heartRateRecordFromRow, profileFromRow, progressActivityFromRow, volumeActivityFromRow } from '../../src/backend/db/rows.js';
import { parseActivityUpdate } from '../../src/backend/services/activity-service.js';
import { parseProfileUpdate } from '../../src/backend/services/profile-service.js';
import { parseRunCSV } from '../../src/backend/ingestion/csv-parser.js';

describe('database and request boundaries', () => {
  it('converts an activity row and rejects malformed required metrics', () => {
    const row = {
      id: 'run-1', start_time: '2026-09-24T08:00:00Z', name: 'Run', run_type: 'easy_base',
      distance_meters: 5000, duration_seconds: 1500, avg_pace_sec_km: 300,
      avg_heart_rate: 145, avg_cadence: 170,
    };
    expect(activityFromRow(row).distance_meters).toBe(5000);
    expect(() => activityFromRow({ ...row, distance_meters: '5000' })).toThrow('activities.distance_meters');
    expect(() => activityFromRow({ ...row, id: null })).toThrow('activities.id');
  });

  it('checks profile row types and rejects unknown request fields', () => {
    expect(profileFromRow({ id: 'primary', resting_hr: 55 }).resting_hr).toBe(55);
    expect(() => profileFromRow({ id: 'primary', resting_hr: '55' })).toThrow('athlete_profile.resting_hr');
    expect(parseProfileUpdate({ resting_hr: 55, gender: 'Male' })).toEqual({ resting_hr: 55, gender: 'Male' });
    expect(parseProfileUpdate({ resting_hr: 'bad' })).toBeNull();
    expect(parseProfileUpdate({ unknown_column: 1 })).toBeNull();
    expect(parseActivityUpdate({ tags: ['Easy Base'] })).toEqual({ tags: ['Easy Base'] });
    expect(parseActivityUpdate({ tags: [5] })).toBeNull();
  });

  it('validates progress, volume, heart-rate, and persisted coach-summary rows', () => {
    const activity = { id: 'run-2', start_time: '2026-09-24', distance_meters: 5000, duration_seconds: 1500,
      elevation_gain_m: null, efficiency_factor: 1.2, run_type: 'easy_base', training_load: null,
      z1_seconds: 0, z2_seconds: 800, z3_seconds: 0, z4_seconds: 0, z5_seconds: 0 };
    expect(volumeActivityFromRow(activity).z2_seconds).toBe(800);
    expect(() => volumeActivityFromRow({ ...activity, z2_seconds: '800' })).toThrow('activities.z2_seconds');
    expect(progressActivityFromRow({ ...activity, avg_pace_sec_km: 300, avg_heart_rate: 145, aerobic_decoupling_pct: null }).id).toBe('run-2');
    expect(heartRateRecordFromRow({ elapsed_seconds: 2, heart_rate: null }).elapsed_seconds).toBe(2);
    expect(() => heartRateRecordFromRow({ elapsed_seconds: '2', heart_rate: 140 })).toThrow('activity_records.elapsed_seconds');

    const coach = { headline: 'Steady', recommendation: 'Keep going', effectiveness_score: 82,
      key_insights_json: '[]', insight_tones_json: null, score_breakdown_json: null, analysis_json: null,
      updated_at: null, steady_pace_sec_km: null, steady_heart_rate: null, steady_cadence: null,
      steady_stance_time: null, pause_breakdown_json: null };
    expect(coachSummaryFromRow(coach).effectiveness_score).toBe(82);
    expect(() => coachSummaryFromRow({ ...coach, effectiveness_score: '82' })).toThrow('activity_coach_summaries.effectiveness_score');
  });

  it('rejects malformed CSV metadata before it reaches SQLite', () => {
    const records = 'timestamp,heart_rate\n2026-09-24T08:00:00Z,140';
    expect(() => parseRunCSV(`# Date: broken\n${records}`, 'run.csv')).toThrow('Invalid activity date');
    expect(() => parseRunCSV(`# Total Distance (m): NaN\n${records}`, 'run.csv')).toThrow('Invalid Total Distance');
  });
});
