import { describe, expect, it } from 'vitest';
import { activityFromRow, profileFromRow } from '../../src/backend/db/rows.js';
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
    expect(parseProfileUpdate({ resting_hr: 55, name: 'Runner' })).toEqual({ resting_hr: 55, name: 'Runner' });
    expect(parseProfileUpdate({ resting_hr: 'bad' })).toBeNull();
    expect(parseProfileUpdate({ unknown_column: 1 })).toBeNull();
    expect(parseActivityUpdate({ tags: ['Easy Base'] })).toEqual({ tags: ['Easy Base'] });
    expect(parseActivityUpdate({ tags: [5] })).toBeNull();
  });

  it('rejects malformed CSV metadata before it reaches SQLite', () => {
    const records = 'timestamp,heart_rate\n2026-09-24T08:00:00Z,140';
    expect(() => parseRunCSV(`# Date: broken\n${records}`, 'run.csv')).toThrow('Invalid activity date');
    expect(() => parseRunCSV(`# Total Distance (m): NaN\n${records}`, 'run.csv')).toThrow('Invalid Total Distance');
  });
});
