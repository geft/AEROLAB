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
      for (const field of ['dob', 'age', 'max_hr', 'resting_hr', 'lt1_hr', 'lt2_hr', 'pb_5k']) {
        expect(row[field], field).toBeNull();
      }
      expect(getAthleteHeartRateProfile(db).hasBaseline).toBe(false);
    } finally { db.close(); }
  });

  it.each([
    { peak: null, expected: 180 },
    { peak: 160, expected: 180 },
    { peak: 180, expected: 180 },
    { peak: 195, expected: 195 },
    { peak: 250, expected: 180 }
  ])('uses age until a plausible recorded peak raises it: $peak', ({ peak, expected }) => {
    const db = openDatabase(':memory:');
    try {
      // Legacy manual settings must not influence automatic calculations.
      db.prepare("UPDATE athlete_profile SET age=40,max_hr=220,resting_hr=45,is_max_hr_estimated=0 WHERE id='primary'").run();
      if (peak != null) {
        db.prepare("INSERT INTO activities(id,start_time,name,run_type,max_heart_rate) VALUES('peak','2026-09-01','Race','race',?)").run(peak);
      }
      expect(getAthleteHeartRateProfile(db).maxHr).toBe(expected);
    } finally { db.close(); }
  });

  it('updates the baseline when age changes and when supporting evidence is deleted', () => {
    const db = openDatabase(':memory:');
    try {
      db.prepare("UPDATE athlete_profile SET age=40,resting_hr=45 WHERE id='primary'").run();
      db.prepare("INSERT INTO activities(id,start_time,run_type,max_heart_rate) VALUES('peak','2026-09-01','easy_base',195)").run();
      expect(getAthleteHeartRateProfile(db).maxHr).toBe(195);
      db.prepare("DELETE FROM activities WHERE id='peak'").run();
      expect(getAthleteHeartRateProfile(db).maxHr).toBe(180);
      db.prepare("UPDATE athlete_profile SET age=50 WHERE id='primary'").run();
      expect(getAthleteHeartRateProfile(db).maxHr).toBe(173);
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
