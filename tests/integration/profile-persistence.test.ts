import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createServer } from '../../src/backend/server.js';
import { getDatabase } from '../../src/backend/db/client.js';
import { realignDatabase } from '../../src/backend/db/realign.js';
import { syncAllCoachSummaries } from '../../src/backend/physiology/coach-summary.js';
import { evaluateThresholdUpdate } from '../../src/backend/physiology/threshold-tracker.js';
import { getBenchmark, toCsv } from '../fixtures/benchmark-runs.js';

describe('Athlete Profile & Resting HR Persistence Tests', () => {
  let app: any;
  const benchmarkContent = toCsv(getBenchmark('bench-easy-60'));

  beforeAll(() => {
    process.env.DATABASE_PATH = ':memory:';
    getDatabase(':memory:');
    app = createServer();
  });

  it('sets and verifies custom resting HR (54 bpm)', async () => {
    const res = await request(app)
      .patch('/api/profile')
      .send({
        resting_hr: 54,
        max_hr: 203,
        dob: '1989-04-15',
        is_configured: 1
      });

    expect(res.status).toBe(200);
    expect(res.body.profile.resting_hr).toBe(54);
    expect(res.body.profile.max_hr).toBe(203);
    expect(res.body.profile.is_configured).toBe(1);

    const getRes = await request(app).get('/api/profile');
    expect(getRes.status).toBe(200);
    expect(getRes.body.profile.resting_hr).toBe(54);
    expect(getRes.body.isConfigured).toBe(true);
  });

  it('does NOT reset resting HR when updating other profile fields', async () => {
    // 1. Update fitness metrics
    const res1 = await request(app)
      .patch('/api/profile')
      .send({ vo2_max: 60, weight_kg: 56, upcoming_benchmark: 'Time Trial 10k' });
    expect(res1.status).toBe(200);
    expect(res1.body.profile.resting_hr).toBe(54);
    expect(res1.body.profile.vo2_max).toBe(60);

    // 2. Update preferences
    const res2 = await request(app)
      .patch('/api/profile')
      .send({
        preferences: {
          filterGallowayBreaks: true,
          filterTrafficStops: false,
          primaryTime: '6:30 AM'
        }
      });
    expect(res2.status).toBe(200);
    expect(res2.body.profile.resting_hr).toBe(54);

    // 3. Update weekly schedule
    const res3 = await request(app)
      .patch('/api/profile')
      .send({
        schedule: {
          monday: '60m Easy Aerobic',
          sunday: 'Rest & Mobility'
        }
      });
    expect(res3.status).toBe(200);
    expect(res3.body.profile.resting_hr).toBe(54);

    // Verify GET /api/profile confirms resting HR is still 54
    const getRes = await request(app).get('/api/profile');
    expect(getRes.body.profile.resting_hr).toBe(54);
  });

  it('rejects invalid or empty resting HR values without corrupting the stored value', async () => {
    // Reject null
    const resNull = await request(app).patch('/api/profile').send({ resting_hr: null });
    expect(resNull.status).toBe(400);
    expect(resNull.body.code).toBe('ERR_INVALID_RESTING_HR');

    // Reject empty string
    const resEmpty = await request(app).patch('/api/profile').send({ resting_hr: '' });
    expect(resEmpty.status).toBe(400);
    expect(resEmpty.body.code).toBe('ERR_INVALID_RESTING_HR');

    // Reject non-numeric string
    const resNonNumeric = await request(app).patch('/api/profile').send({ resting_hr: 'abc' });
    expect(resNonNumeric.status).toBe(400);
    expect(resNonNumeric.body.code).toBe('ERR_INVALID_RESTING_HR');

    // Reject implausible resting HR (< 30 bpm)
    const resTooLow = await request(app).patch('/api/profile').send({ resting_hr: 15 });
    expect(resTooLow.status).toBe(400);
    expect(resTooLow.body.code).toBe('ERR_INVALID_RESTING_HR');

    // Reject implausible resting HR (> 120 bpm)
    const resTooHigh = await request(app).patch('/api/profile').send({ resting_hr: 140 });
    expect(resTooHigh.status).toBe(400);
    expect(resTooHigh.body.code).toBe('ERR_INVALID_RESTING_HR');

    // Verify stored resting HR is completely intact and never became null or default 50
    const verifyRes = await request(app).get('/api/profile');
    expect(verifyRes.body.profile.resting_hr).toBe(54);
  });

  it('rejects invalid maximum HR values and empty profile updates', async () => {
    for (const maxHr of [99, 241, '190', Number.NaN]) {
      const response = await request(app).patch('/api/profile').send({ max_hr: maxHr });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('ERR_INVALID_MAX_HR');
    }

    const unknown = await request(app).patch('/api/profile').send({ unsupported_field: true });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('ERR_INVALID_PROFILE_INPUT');

    const verify = await request(app).get('/api/profile');
    expect(verify.body.profile.max_hr).toBe(203);
  });

  it('does NOT reset resting HR across database re-initialization and migrations', async () => {
    const db = getDatabase();
    // Simulate database migrations and table ensures from client.ts
    realignDatabase(db);
    syncAllCoachSummaries(db);

    const row = db.prepare('SELECT resting_hr, max_hr, is_configured FROM athlete_profile WHERE id = ?').get('primary') as any;
    expect(row.resting_hr).toBe(54);
    expect(row.max_hr).toBe(203);
    expect(row.is_configured).toBe(1);
  });

  it('does NOT reset resting HR during threshold evaluation and coach summaries sync', async () => {
    const db = getDatabase();

    // 1. Run syncAllCoachSummaries
    const synced = syncAllCoachSummaries(db);
    expect(typeof synced).toBe('number');

    let row = db.prepare('SELECT resting_hr FROM athlete_profile WHERE id = ?').get('primary') as any;
    expect(row.resting_hr).toBe(54);

    // 2. Insert test activity and evaluate thresholds
    db.prepare(`
      INSERT OR IGNORE INTO activities (id, name, start_time, duration_seconds, distance_meters, avg_heart_rate)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('test-activity-1', 'Test Aerobic Run', '2026-03-10T08:00:00Z', 3600, 10000, 145);

    evaluateThresholdUpdate(
      db,
      'test-activity-1',
      '2026-03-10',
      'easy_base',
      { id: 'test-activity-1', totalDurationSeconds: 3600 } as any,
      [],
      { movingDurationSeconds: 3600, avgMovingHeartRate: 145, avgMovingPaceSecKm: 340, aerobicDecouplingPct: 2.1 } as any
    );

    row = db.prepare('SELECT resting_hr FROM athlete_profile WHERE id = ?').get('primary') as any;
    expect(row.resting_hr).toBe(54);
  });

  it('does NOT reset resting HR when importing or uploading new activities', async () => {
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: benchmarkContent, filename: 'bench_easy_persistence.csv' });

    expect(res.status).toBe(200);

    const getRes = await request(app).get('/api/profile');
    expect(getRes.body.profile.resting_hr).toBe(54);
  });

  it('calculates heart rate zones using the athlete custom resting HR and not fallback 50', async () => {
    const res = await request(app).get('/api/thresholds');
    expect(res.status).toBe(200);

    // A sub-threshold 145 bpm run does not lower LT1; Z1 follows the athlete’s HR reserve.
    // Zone 4 ends at the LT2 anchor rather than the 90% HRR cutoff.
    expect(res.body.zones.z1[1]).toBe(134);
    expect(res.body.zones.z4[1]).toBe(176);
    expect(res.body.zones.z5[0]).toBe(177);

    // Verify GET /api/profile zones also reflect the custom resting HR and persisted profile
    const profRes = await request(app).get('/api/profile');
    expect(profRes.body.profile.resting_hr).toBe(54);
    expect(profRes.body.zones.z1[1]).toBe(134);
    expect(profRes.body.zones.z4[1]).toBe(176);
    expect(profRes.body.zones.z5[0]).toBe(177);
  });
});
