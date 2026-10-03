import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../src/backend/db/client.js';
import { importRunContent } from '../../src/backend/ingestion/importer.js';
import { updateActivityService } from '../../src/backend/services/activity-service.js';
import { recomputeProfileDerivedData } from '../../src/backend/physiology/profile-recompute.js';
import { affectedActivityIds, rebuildAffectedHistory } from '../../src/backend/application/analysis/rebuild-history.js';
import { thresholdTime } from '../../src/shared/threshold-trend.js';
import { traceCsv, workoutTrace } from '../fixtures/workout-trace.js';

describe('Centralized history invalidation', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = openDatabase(':memory:');
    db.prepare("UPDATE athlete_profile SET max_hr=190,resting_hr=50,is_max_hr_estimated=0 WHERE id='primary'").run();
  });
  afterEach(() => db.close());
  const seed = (id: string, date: string, hr = 155) => {
    expect(importRunContent(db, traceCsv(workoutTrace([{ seconds: 2400, hr }], { id, date })), `${id}.csv`).status).toBe('imported');
  };
  const observation = () => db.prepare(`INSERT INTO physiological_thresholds
    (effective_date,source_activity_id,source_kind,lt2_hr,confidence) VALUES('2026-01-02','source','workout',155,0.95)`).run();
  const snapshot = () => ({
    activities: db.prepare('SELECT id,run_type,auto_run_type,manual_run_type,manual_failed_workout,tags,training_load,z4_seconds FROM activities ORDER BY id').all(),
    evidence: db.prepare('SELECT source_activity_id,source_kind,lt1_hr,lt2_hr FROM physiological_thresholds ORDER BY id').all()
  });

  it('selects the inclusive affected range and does nothing for an empty range', () => {
    seed('first', '2026-01-02'); seed('later', '2026-01-03');
    expect(affectedActivityIds(db, thresholdTime('2026-01-02'))).toEqual(['first', 'later']);
    const before = snapshot();
    expect(rebuildAffectedHistory(db, { fromTime: thresholdTime('2027-01-01') }).activitiesProcessed).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  it.each([{ is_failed_workout: true }, { run_type: 'recovery' }])('removes ineligible source evidence and rebuilds later labels for %j', patch => {
    seed('source', '2026-01-02'); observation(); seed('later', '2026-01-03');
    expect(db.prepare("SELECT run_type FROM activities WHERE id='later'").get()).toEqual({ run_type: 'threshold_lt2' });
    expect(updateActivityService(db, 'source', patch).ok).toBe(true);
    expect(db.prepare("SELECT COUNT(*) n FROM physiological_thresholds WHERE source_activity_id='source' AND source_kind='workout'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT run_type FROM activities WHERE id='later'").get()).toEqual({ run_type: 'easy_base' });
    const corrected = snapshot();
    rebuildAffectedHistory(db);
    expect(snapshot()).toEqual(corrected);
  });

  it('rolls back the confirmation and all earlier writes when dependent replay fails', () => {
    seed('source', '2026-01-02'); observation(); seed('later', '2026-01-03');
    db.prepare("INSERT INTO activity_fit_details(activity_id,metadata_json) VALUES('later','bad json')").run();
    const before = snapshot();
    expect(() => updateActivityService(db, 'source', { is_failed_workout: true })).toThrow('Dependent reanalysis failed');
    expect(snapshot()).toEqual(before);
  });

  it('does not replay physiological history for a cosmetic edit', () => {
    seed('source', '2026-01-02'); seed('later', '2026-01-03');
    db.prepare("INSERT INTO activity_fit_details(activity_id,metadata_json) VALUES('later','bad json')").run();
    const before = snapshot();
    expect(updateActivityService(db, 'source', { name: 'New title' }).ok).toBe(true);
    expect(snapshot()).toEqual(before);
    expect(db.prepare("SELECT name FROM activities WHERE id='source'").get()).toEqual({ name: 'New title' });
  });

  it('reclassifies history after baseline HR changes while retaining confirmations and external evidence', () => {
    seed('source', '2026-01-02'); seed('later', '2026-01-03');
    updateActivityService(db, 'source', { run_type: 'recovery' });
    db.prepare("UPDATE athlete_profile SET max_hr=175 WHERE id='primary'").run();
    expect(recomputeProfileDerivedData(db, true)).toBe(2);
    expect(db.prepare("SELECT run_type,manual_run_type FROM activities WHERE id='source'").get())
      .toEqual({ run_type: 'recovery', manual_run_type: 'recovery' });
    expect(db.prepare("SELECT auto_run_type FROM activities WHERE id='later'").get()).toEqual({ auto_run_type: 'threshold_lt2' });
    db.prepare(`INSERT INTO physiological_thresholds(effective_date,source_kind,lt2_hr,confidence)
      VALUES('2026-01-01','external',160,0.95)`).run();
    rebuildAffectedHistory(db);
    expect(db.prepare("SELECT lt2_hr FROM physiological_thresholds WHERE source_kind='external'").get()).toEqual({ lt2_hr: 160 });
  });
});
