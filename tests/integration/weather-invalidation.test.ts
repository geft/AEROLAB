import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/backend/db/client.js';
import { importRunContent } from '../../src/backend/ingestion/importer.js';
import { refreshActivityWeatherService } from '../../src/backend/services/activity-service.js';
import { currentDatabaseOperation } from '../../src/backend/application/database-operations.js';
import { traceCsv, workoutTrace } from '../fixtures/workout-trace.js';

describe('weather-only history invalidation', () => {
  let db: ReturnType<typeof openDatabase>;
  beforeEach(() => {
    db = openDatabase(':memory:');
    db.prepare("UPDATE athlete_profile SET max_hr=190,resting_hr=50,is_max_hr_estimated=0 WHERE id='primary'").run();
    for (const [id, date] of [['earlier', '2026-01-01'], ['source', '2026-01-02'], ['later', '2026-01-03']]) {
      expect(importRunContent(db, traceCsv(workoutTrace([{ seconds: 1200, hr: 140 }], { id, date: `${date} 00:00:00` })), `${id}.csv`).status).toBe('imported');
    }
    db.prepare("UPDATE activities SET workout_lat=40,workout_lon=-70 WHERE id='source'").run();
    db.prepare("UPDATE activity_coach_summaries SET headline='stale' WHERE activity_id IN ('earlier','source','later')").run();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).includes('/archive?')
      ? new Response(JSON.stringify({ hourly: { time: ['2026-01-02T00:00'], temperature_2m: [30], relative_humidity_2m: [75], apparent_temperature: [34], weather_code: [1] } }))
      : new Response('{}', { status: 503 }));
  });
  afterEach(() => { vi.restoreAllMocks(); db.close(); });

  const physiology = () => db.prepare('SELECT id,run_type,training_load,z2_seconds FROM activities ORDER BY id').all();
  it('refreshes the edited and later coaching while retaining earlier summaries and physiology', async () => {
    const before = physiology();
    const result = await refreshActivityWeatherService(db, 'source');
    expect(result?.activity.weather_temperature_c).toBe(30);
    const headlines = db.prepare('SELECT activity_id,headline FROM activity_coach_summaries ORDER BY activity_id').all() as Array<{ activity_id: string; headline: string }>;
    expect(headlines.find(row => row.activity_id === 'earlier')?.headline).toBe('stale');
    expect(headlines.filter(row => row.activity_id !== 'earlier').every(row => row.headline !== 'stale')).toBe(true);
    expect(physiology()).toEqual(before);
    expect(currentDatabaseOperation()).toBeNull();
  });

  it('rolls weather and all affected coaching back if a dependent summary cannot be rebuilt', async () => {
    db.prepare("INSERT INTO activity_fit_details(activity_id,metadata_json) VALUES('later','bad json')").run();
    await expect(refreshActivityWeatherService(db, 'source')).rejects.toThrow();
    expect(db.prepare("SELECT weather_temperature_c FROM activities WHERE id='source'").get()).toEqual({ weather_temperature_c: null });
    expect(db.prepare("SELECT COUNT(*) n FROM activity_coach_summaries WHERE headline='stale'").get()).toEqual({ n: 3 });
    expect(currentDatabaseOperation()).toBeNull();
  });
});
