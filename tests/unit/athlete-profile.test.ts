import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../src/backend/db/client.js';
import { getAthleteHeartRateProfile } from '../../src/backend/physiology/athlete-profile.js';
import { realignDatabase } from '../../src/backend/db/realign.js';
import { resolveHeartRateProfile } from '../../src/shared/heart-rate.js';

describe('Athlete-independent baseline', () => {
  it('keeps a fresh profile free of personal measurements, including after realignment', () => {
    const db = openDatabase(':memory:');
    try {
      realignDatabase(db);
      const row = db.prepare("SELECT * FROM athlete_profile WHERE id = 'primary'").get() as any;
      for (const field of ['dob', 'age', 'max_hr', 'resting_hr', 'lt1_hr', 'lt2_hr', 'vo2_max', 'pb_5k', 'location']) {
        expect(row[field], field).toBeNull();
      }
      expect(getAthleteHeartRateProfile(db).hasBaseline).toBe(false);
    } finally { db.close(); }
  });

  it('uses an entered maximum even when a workout contains a higher peak', () => {
    const db = openDatabase(':memory:');
    try {
      db.prepare("UPDATE athlete_profile SET max_hr = 175, resting_hr = 45, is_max_hr_estimated = 0 WHERE id = 'primary'").run();
      db.prepare("INSERT INTO activities (id, start_time, name, run_type, max_heart_rate) VALUES ('peak', '2026-09-01', 'Race', 'race', 195)").run();
      expect(getAthleteHeartRateProfile(db).maxHr).toBe(175);
      db.prepare("UPDATE athlete_profile SET is_max_hr_estimated = 1 WHERE id = 'primary'").run();
      expect(getAthleteHeartRateProfile(db).maxHr).toBe(195);
    } finally { db.close(); }
  });

  it('marks missing inputs as estimates and derives distinct thresholds from actual inputs', () => {
    expect(resolveHeartRateProfile().isEstimated).toBe(true);
    expect(resolveHeartRateProfile().hasBaseline).toBe(false);
    const lower = resolveHeartRateProfile({ maxHr: 160, restingHr: 45 });
    const higher = resolveHeartRateProfile({ maxHr: 210, restingHr: 65 });
    expect(lower.lt1Hr).toBeLessThan(145);
    expect(higher.lt1Hr).toBeGreaterThan(155);
    expect(lower.isEstimated).toBe(false);
  });
});
