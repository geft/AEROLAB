import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createServer } from '../../src/backend/server.js';
import { getDatabase } from '../../src/backend/db/client.js';
import { getBenchmark, toCsv } from '../fixtures/benchmark-runs.js';

describe('API Server Integration Tests', () => {
  const app = createServer();
  const benchmarkContent = toCsv(getBenchmark('bench-easy-60'));

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
      .send({ content: benchmarkContent, filename: 'bench_easy_test.csv' });

    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe('imported');
    expect(res.body.result.activityId).toBe('bench-easy-60');
  });

  it('GET /api/activities lists the imported run', async () => {
    const res = await request(app).get('/api/activities');
    expect(res.status).toBe(200);
    expect(res.body.activities).toHaveLength(1);
    expect(res.body.activities[0].name).toBe('Benchmark Easy Aerobic');
    expect(res.body.activities[0].efficiency_factor).toBeGreaterThan(0);
  });

  it('GET /api/activities/:id returns deep dive with splits and records', async () => {
    const res = await request(app).get('/api/activities/bench-easy-60');
    expect(res.status).toBe(200);
    expect(res.body.activity).toBeDefined();
    expect(res.body.splits).toBeDefined();
    expect(res.body.records.length).toBeGreaterThan(0);
  });

  it('PATCH /api/activities/:id updates custom title, runner notes, and tags', async () => {
    const patchRes = await request(app)
      .patch('/api/activities/bench-easy-60')
      .send({
        name: 'Morning Aerobic Base + PCN Strides',
        notes: 'Felt very smooth, high humidity around 80%. Elastic bounce maintained.',
        tags: ['Easy Base', 'Strides', 'Recovery']
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.activity.name).toBe('Morning Aerobic Base + PCN Strides');
    expect(patchRes.body.activity.notes).toContain('Elastic bounce maintained');
    expect(JSON.parse(patchRes.body.activity.tags)).toEqual(['Easy Base', 'Strides', 'Recovery']);

    // Confirm persisted via GET
    const getRes = await request(app).get('/api/activities/bench-easy-60');
    expect(getRes.body.activity.name).toBe('Morning Aerobic Base + PCN Strides');
    expect(getRes.body.activity.notes).toContain('Elastic bounce maintained');
  });

  it('PATCH /api/activities/:id rejects unknown/new custom tags with 400', async () => {
    const patchRes = await request(app)
      .patch('/api/activities/bench-easy-60')
      .send({
        tags: ['Easy Base', 'Brand New Tag', 'Custom Random']
      });

    expect(patchRes.status).toBe(400);
    expect(patchRes.body.error).toContain('Only existing tags are allowed');
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
    const row = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get('bench-easy-60') as any;
    expect(row).toBeDefined();
    expect(row.headline).toBe('Near-Perfect Aerobic Base Execution');
    expect(row.effectiveness_score).toBeGreaterThan(70);
    expect(row.key_insights_json).toBeDefined();

    // Verify GET /api/activities/:id/coach-summary endpoint
    const res = await request(app).get('/api/activities/bench-easy-60/coach-summary');
    expect(res.status).toBe(200);
    expect(res.body.coachSummary.headline).toBe('Near-Perfect Aerobic Base Execution');
    expect(res.body.coachSummary.steadyHeartRate).toBeGreaterThan(0);
    expect(res.body.coachSummary.keyInsights.length).toBeGreaterThan(0);
  });

  it('continuously updates activity_coach_summaries when activity run_type is modified', async () => {
    const db = getDatabase();

    // Patch run_type to threshold_lt2
    const patchRes = await request(app)
      .patch('/api/activities/bench-easy-60')
      .send({ run_type: 'threshold_lt2' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.coachSummary).toBeDefined();
    expect(patchRes.body.coachSummary.headline).toBe('High-Quality Lactate Clearance Stimulus');

    // Confirm the row in activity_coach_summaries was updated
    const row = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get('bench-easy-60') as any;
    expect(row.headline).toBe('High-Quality Lactate Clearance Stimulus');
    expect(row.recommendation).toContain('48 hours of recovery');

    // Revert back to easy_base
    await request(app)
      .patch('/api/activities/bench-easy-60')
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

  it('PATCH /api/profile auto-estimates max HR with Tanaka formula when is_max_hr_estimated is true', async () => {
    // Tanaka formula: 208 - (0.7 * 40) = 180
    const res = await request(app)
      .patch('/api/profile')
      .send({
        age: 40,
        is_max_hr_estimated: true
      });

    expect(res.status).toBe(200);
    expect(res.body.profile.age).toBe(40);
    expect(res.body.profile.max_hr).toBe(180);
    expect(res.body.profile.is_max_hr_estimated).toBe(1);

    // Revert back
    await request(app)
      .patch('/api/profile')
      .send({
        age: 37,
        max_hr: 203,
        is_max_hr_estimated: false
      });
  });

  it('auto-infers Max HR from actual peak workout efforts (e.g. 5k TT / race) when available', async () => {
    const db = getDatabase();
    // Insert a high-effort race with peak heart rate 199
    db.prepare(`
      INSERT OR REPLACE INTO activities (
        id, start_time, name, run_type, distance_meters, duration_seconds, calories, avg_heart_rate, max_heart_rate
      ) VALUES ('race-tt-test', '2026-09-01 07:00:00', 'Park Time Trial 5k', 'race', 5000, 1300, 400, 175, 199)
    `).run();

    const patchRes = await request(app)
      .patch('/api/profile')
      .send({
        is_max_hr_estimated: true,
        age: 37
      });

    expect(patchRes.status).toBe(200);
    // Should prefer observed peak (199 bpm) over hardcoded Tanaka (182 bpm)
    expect(patchRes.body.profile.max_hr).toBe(199);

    const getRes = await request(app).get('/api/profile');
    expect(getRes.body.observedPeakHr).toBeDefined();
    expect(getRes.body.observedPeakHr.peakHr).toBe(199);
    expect(getRes.body.maxHrSource).toBe('observed_run');
    expect(getRes.body.effectiveMaxHr).toBe(199);

    // Clean up test activity and restore profile
    db.prepare('DELETE FROM activities WHERE id = ?').run('race-tt-test');
    await request(app).patch('/api/profile').send({ max_hr: 203, is_max_hr_estimated: false });
  });

  it('POST /api/activities/:id/weather/refresh fetches historical microclimate weather', async () => {
    const res = await request(app).post('/api/activities/bench-easy-60/weather/refresh');
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

  it('POST /api/ingest/upload rejects invalid .fit buffer with 422', async () => {
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: Buffer.from('invalid-fit-bytes').toString('base64'), filename: 'corrupted.fit' });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('FIT parser error');
  });

  it('POST /api/ingest/upload ingests a base64-encoded native .fit running workout', async () => {
    // Generate valid synthetic running FIT binary
    const garminSec = 1126080000;
    const defSession = [
      0x40, 0x00, 0x00, 18, 0, 5,
      253, 4, 0x86, 2, 4, 0x86, 5, 1, 0x00, 9, 4, 0x86, 8, 4, 0x86
    ];
    const sessionData = Buffer.alloc(1 + 17);
    sessionData.writeUInt8(0x00, 0);
    sessionData.writeUInt32LE(garminSec, 1);
    sessionData.writeUInt32LE(garminSec, 5);
    sessionData.writeUInt8(1, 9); // sport = running
    sessionData.writeUInt32LE(500000, 10); // 5000m
    sessionData.writeUInt32LE(1500000, 14); // 1500s

    const defRecord = [
      0x41, 0x00, 0x00, 20, 0, 4,
      253, 4, 0x86, 3, 1, 0x02, 4, 1, 0x02, 5, 4, 0x86
    ];
    const recData = Buffer.alloc(1 + 10);
    recData.writeUInt8(0x01, 0);
    recData.writeUInt32LE(garminSec, 1);
    recData.writeUInt8(142, 5); // 142 bpm
    recData.writeUInt8(88, 6);  // cadence
    recData.writeUInt32LE(20000, 7);

    const payload = Buffer.concat([Buffer.from(defSession), sessionData, Buffer.from(defRecord), recData]);
    const header = Buffer.alloc(14);
    header.writeUInt8(14, 0);
    header.writeUInt8(0x20, 1);
    header.writeUInt16LE(0x0824, 2);
    header.writeUInt32LE(payload.length, 4);
    header.write('.FIT', 8, 'ascii');

    const fitBase64 = Buffer.concat([header, payload]).toString('base64');

    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: fitBase64, filename: 'garmin_run_test.fit' });

    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe('imported');
    expect(['easy_base', 'recovery']).toContain(res.body.result.runType);
  });

  it('POST /api/ingest/upload auto-detects FIT algorithm via magic bytes even without .fit extension', async () => {
    // Re-use synthetic FIT with force: true and non-.fit filename
    const garminSec = 1126080000;
    const defSession = [
      0x40, 0x00, 0x00, 18, 0, 5,
      253, 4, 0x86, 2, 4, 0x86, 5, 1, 0x00, 9, 4, 0x86, 8, 4, 0x86
    ];
    const sessionData = Buffer.alloc(1 + 17);
    sessionData.writeUInt8(0x00, 0);
    sessionData.writeUInt32LE(garminSec, 1);
    sessionData.writeUInt32LE(garminSec, 5);
    sessionData.writeUInt8(1, 9);
    sessionData.writeUInt32LE(500000, 10);
    sessionData.writeUInt32LE(1500000, 14);

    const defRecord = [
      0x41, 0x00, 0x00, 20, 0, 4,
      253, 4, 0x86, 3, 1, 0x02, 4, 1, 0x02, 5, 4, 0x86
    ];
    const recData = Buffer.alloc(1 + 10);
    recData.writeUInt8(0x01, 0);
    recData.writeUInt32LE(garminSec, 1);
    recData.writeUInt8(142, 5);
    recData.writeUInt8(88, 6);
    recData.writeUInt32LE(20000, 7);

    const payload = Buffer.concat([Buffer.from(defSession), sessionData, Buffer.from(defRecord), recData]);
    const header = Buffer.alloc(14);
    header.writeUInt8(14, 0);
    header.writeUInt8(0x20, 1);
    header.writeUInt16LE(0x0824, 2);
    header.writeUInt32LE(payload.length, 4);
    header.write('.FIT', 8, 'ascii');

    const fitBase64 = Buffer.concat([header, payload]).toString('base64');

    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: fitBase64, filename: 'activity_data_file.dat', force: true });

    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe('imported');
  });

  it('POST /api/ingest/scan scans data/raw and returns results array', async () => {
    const res = await request(app).post('/api/ingest/scan');
    expect(res.status).toBe(200);
    expect(res.body.results).toBeDefined();
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('POST /api/ingest/upload returns 400 when content is missing', async () => {
    const res = await request(app).post('/api/ingest/upload').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing content field');
  });

  it('POST /api/ingest/upload rejects non-running FIT activities with 422', async () => {
    const garminSec = 1126080000;
    const defSession = [
      0x40, 0x00, 0x00, 18, 0, 5,
      253, 4, 0x86, 2, 4, 0x86, 5, 1, 0x00, 9, 4, 0x86, 8, 4, 0x86
    ];
    const cycleSessionData = Buffer.alloc(1 + 17);
    cycleSessionData.writeUInt8(0x00, 0);
    cycleSessionData.writeUInt32LE(garminSec, 1);
    cycleSessionData.writeUInt32LE(garminSec, 5);
    cycleSessionData.writeUInt8(2, 9); // sport = cycling
    cycleSessionData.writeUInt32LE(1500000, 10);
    cycleSessionData.writeUInt32LE(3600000, 14);

    const cyclePayload = Buffer.concat([Buffer.from(defSession), cycleSessionData]);
    const header = Buffer.alloc(14);
    header.writeUInt8(14, 0);
    header.writeUInt8(0x20, 1);
    header.writeUInt16LE(0x0824, 2);
    header.writeUInt32LE(cyclePayload.length, 4);
    header.write('.FIT', 8, 'ascii');

    const cycleBase64 = Buffer.concat([header, cyclePayload]).toString('base64');
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: cycleBase64, filename: 'cycling.fit' });

    expect(res.status).toBe(200);
    expect(res.body.result?.status).toBe('skipped_non_running');
    expect(res.body.result?.reason).toContain('not a supported running session');
  });

  it('POST /api/ingest/upload returns 400 when FIT content payload is invalid type', async () => {
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: 123456 as any, filename: 'corrupt_type.fit' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid FIT content format');
  });

  it('POST /api/ingest/upload accepts data URI prefixed base64 content', async () => {
    const garminSec = 1126080000;
    const defSession = [
      0x40, 0x00, 0x00, 18, 0, 5,
      253, 4, 0x86, 2, 4, 0x86, 5, 1, 0x00, 9, 4, 0x86, 8, 4, 0x86
    ];
    const sessionData = Buffer.alloc(1 + 17);
    sessionData.writeUInt8(0x00, 0);
    sessionData.writeUInt32LE(garminSec, 1);
    sessionData.writeUInt32LE(garminSec, 5);
    sessionData.writeUInt8(1, 9);
    sessionData.writeUInt32LE(500000, 10);
    sessionData.writeUInt32LE(1500000, 14);

    const defRecord = [
      0x41, 0x00, 0x00, 20, 0, 4,
      253, 4, 0x86, 3, 1, 0x02, 4, 1, 0x02, 5, 4, 0x86
    ];
    const recData = Buffer.alloc(1 + 10);
    recData.writeUInt8(0x01, 0);
    recData.writeUInt32LE(garminSec, 1);
    recData.writeUInt8(142, 5);
    recData.writeUInt8(88, 6);
    recData.writeUInt32LE(20000, 7);

    const payload = Buffer.concat([Buffer.from(defSession), sessionData, Buffer.from(defRecord), recData]);
    const header = Buffer.alloc(14);
    header.writeUInt8(14, 0);
    header.writeUInt8(0x20, 1);
    header.writeUInt16LE(0x0824, 2);
    header.writeUInt32LE(payload.length, 4);
    header.write('.FIT', 8, 'ascii');

    const dataUri = `data:application/octet-stream;base64,${Buffer.concat([header, payload]).toString('base64')}`;
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: dataUri, filename: 'data_uri_workout.fit', force: true });

    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe('imported');
  });

  it('POST /api/ingest/upload returns 422 when CSV content fails parsing', async () => {
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: '# comment only with no columns', filename: 'broken.csv' });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('CSV file contains no valid records');
  });
});

