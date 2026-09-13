import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { createServer } from '../../src/backend/server.js';
import { getDatabase } from '../../src/backend/db/client.js';

describe('API Server Integration Tests', () => {
  const app = createServer();
  const samplePath = path.resolve(__dirname, '../fixtures/sample-run.csv');
  const sampleContent = fs.readFileSync(samplePath, 'utf8');

  beforeAll(() => {
    // In-memory test DB
    process.env.DATABASE_PATH = ':memory:';
    getDatabase(':memory:');
  });

  it('GET /api/health returns ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /api/ingest/upload ingests a run CSV', async () => {
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: sampleContent, filename: 'singapore_test.csv' });

    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe('imported');
    expect(res.body.result.activityId).toBe('24321232759');
  });

  it('GET /api/activities lists the imported run', async () => {
    const res = await request(app).get('/api/activities');
    expect(res.status).toBe(200);
    expect(res.body.activities).toHaveLength(1);
    expect(res.body.activities[0].name).toBe('Singapore Running');
    expect(res.body.activities[0].efficiency_factor).toBeGreaterThan(0);
  });

  it('GET /api/activities/:id returns deep dive with splits and records', async () => {
    const res = await request(app).get('/api/activities/24321232759');
    expect(res.status).toBe(200);
    expect(res.body.activity).toBeDefined();
    expect(res.body.splits).toBeDefined();
    expect(res.body.records.length).toBeGreaterThan(0);
  });

  it('PATCH /api/activities/:id updates custom title, runner notes, and tags', async () => {
    const patchRes = await request(app)
      .patch('/api/activities/24321232759')
      .send({
        name: 'Morning Aerobic Base + PCN Strides',
        notes: 'Felt very smooth, high humidity around 80%. Elastic bounce maintained.',
        tags: ['Easy Base', 'Strides', 'Morning Run']
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.activity.name).toBe('Morning Aerobic Base + PCN Strides');
    expect(patchRes.body.activity.notes).toContain('Elastic bounce maintained');
    expect(JSON.parse(patchRes.body.activity.tags)).toEqual(['Easy Base', 'Strides', 'Morning Run']);

    // Confirm persisted via GET
    const getRes = await request(app).get('/api/activities/24321232759');
    expect(getRes.body.activity.name).toBe('Morning Aerobic Base + PCN Strides');
    expect(getRes.body.activity.notes).toContain('Elastic bounce maintained');
  });

  it('GET /api/activities?type=easy_base filters correctly', async () => {
    const res = await request(app).get('/api/activities?type=easy_base');
    expect(res.status).toBe(200);
    expect(res.body.activities).toHaveLength(1);

    const emptyRes = await request(app).get('/api/activities?type=intervals_vo2');
    expect(emptyRes.status).toBe(200);
    expect(emptyRes.body.activities).toHaveLength(0);
  });

  it('GET /api/thresholds returns threshold data', async () => {
    const res = await request(app).get('/api/thresholds');
    expect(res.status).toBe(200);
    expect(res.body.latest).toBeDefined();
    expect(res.body.history).toBeDefined();
    expect(res.body.economyTrend).toBeDefined();
  });

  it('persists AI coach summary in activity_coach_summaries table upon ingestion and returns it', async () => {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get('24321232759') as any;
    expect(row).toBeDefined();
    expect(row.headline).toBe('Productive Zone 2 Aerobic Foundation');
    expect(row.effectiveness_score).toBeGreaterThan(70);
    expect(row.key_insights_json).toBeDefined();

    // Verify GET /api/activities/:id/coach-summary endpoint
    const res = await request(app).get('/api/activities/24321232759/coach-summary');
    expect(res.status).toBe(200);
    expect(res.body.coachSummary.headline).toBe('Productive Zone 2 Aerobic Foundation');
    expect(res.body.coachSummary.steadyHeartRate).toBeGreaterThan(0);
    expect(res.body.coachSummary.keyInsights.length).toBeGreaterThan(0);
  });

  it('continuously updates activity_coach_summaries when activity run_type is modified', async () => {
    const db = getDatabase();

    // Patch run_type to threshold_lt2
    const patchRes = await request(app)
      .patch('/api/activities/24321232759')
      .send({ run_type: 'threshold_lt2' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.coachSummary).toBeDefined();
    expect(patchRes.body.coachSummary.headline).toBe('High-Quality Lactate Clearance Stimulus');

    // Confirm the row in activity_coach_summaries was updated
    const row = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get('24321232759') as any;
    expect(row.headline).toBe('High-Quality Lactate Clearance Stimulus');
    expect(row.recommendation).toContain('48 hours of recovery');

    // Revert back to easy_base
    await request(app)
      .patch('/api/activities/24321232759')
      .send({ run_type: 'easy_base' });
  });

  it('GET /api/profile returns athlete baseline and HRR zones', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(200);
    expect(res.body.profile.max_hr).toBe(203);
    expect(res.body.profile.resting_hr).toBe(55);
    expect(res.body.currentThresholds.lt1Hr).toBe(148);
    expect(res.body.currentThresholds.lt2Hr).toBe(167);
    expect(res.body.currentThresholds.lt1Range).toEqual([147, 149]);
    expect(res.body.zones.z1[1]).toBe(134);
    expect(res.body.zones.z2[1]).toBe(148);
    expect(res.body.zones.z3[0]).toBe(149);
    expect(res.body.zones.z4[0]).toBe(167);
  });

  it('PATCH /api/profile continuously syncs all coach summaries across database', async () => {
    const res = await request(app)
      .patch('/api/profile')
      .send({ vo2_max: 59, upcoming_benchmark: '10k Garmin Race Oct 2026' });

    expect(res.status).toBe(200);
    expect(res.body.profile.vo2_max).toBe(59);
    expect(res.body.profile.upcoming_benchmark).toBe('10k Garmin Race Oct 2026');
    expect(res.body.syncedActivitiesCount).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/activities/:id/weather/refresh fetches historical microclimate weather', async () => {
    const res = await request(app).post('/api/activities/24321232759/weather/refresh');
    expect(res.status).toBe(200);
    expect(res.body.activity).toBeDefined();
    expect(res.body.weather).toBeDefined();
    if (res.body.weather.temperatureC !== null) {
      expect(res.body.weather.temperatureC).toBeGreaterThan(0);
      expect(res.body.weather.humidityPct).toBeGreaterThan(0);
      expect(res.body.activity.weather_temperature_c).toBe(res.body.weather.temperatureC);
    }
  });

  it('GET /api/activities/progress-history returns monthly and yearly progression aggregations', async () => {
    const res = await request(app).get('/api/activities/progress-history');
    expect(res.status).toBe(200);
    expect(res.body.months).toBeDefined();
    expect(res.body.years).toBeDefined();
    expect(Array.isArray(res.body.months)).toBe(true);
    expect(Array.isArray(res.body.years)).toBe(true);
    expect(res.body.months.length).toBeGreaterThan(0);
    expect(res.body.months[0].totalDistanceKm).toBeGreaterThan(0);
    expect(res.body.months[0].avgEfficiencyFactor).toBeGreaterThan(0);
  });

  it('GET /api/activities/progress-history filters by run_type (easy vs threshold)', async () => {
    // With sample run (which is easy_base), easy should return the run
    const easyRes = await request(app).get('/api/activities/progress-history?run_type=easy');
    expect(easyRes.status).toBe(200);
    expect(easyRes.body.months.length).toBeGreaterThan(0);

    // threshold should return empty months
    const threshRes = await request(app).get('/api/activities/progress-history?run_type=threshold');
    expect(threshRes.status).toBe(200);
    expect(threshRes.body.months).toHaveLength(0);
  });
});

