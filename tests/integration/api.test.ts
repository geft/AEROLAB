import { sealFit } from '../fixtures/fit-binary.mjs';
import { seedBenchmarkProfile } from '../fixtures/benchmark-runs.js';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createServer } from '../../src/backend/server.js';
import { getDatabase } from '../../src/backend/db/client.js';
import { importRunContent } from '../../src/backend/ingestion/importer.js';
import { getBenchmark, toCsv } from '../fixtures/benchmark-runs.js';

describe('API Server Integration Tests', () => {
  let app: any;
  const benchmarkContent = toCsv(getBenchmark('bench-easy-60'));

  beforeAll(() => {
    // In-memory test DB
    process.env.DATABASE_PATH = ':memory:';
    // A replay must retain dated external evidence, rather than an arbitrary current cache.
    seedBenchmarkProfile(getDatabase(':memory:'), { datedThresholds: true });
    app = createServer();
  });

  it('GET /api/health returns ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('loads an existing legacy CSV run for the API history fixture', () => {
    expect(importRunContent(getDatabase(), benchmarkContent, 'bench_easy_test.csv').status).toBe('imported');
  });

  it('GET /api/activities lists the imported run', async () => {
    const res = await request(app).get('/api/activities');
    expect(res.status).toBe(200);
    expect(res.body.activities).toHaveLength(1);
    expect(res.body.activities[0].name).toBe('Benchmark Easy Aerobic');
    expect(res.body.activities[0].efficiency_factor).toBeGreaterThan(0);
  });

  it('GET /api/activities/:id returns deep dive with splits and records', async () => {
    const weatherFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected weather lookup'));
    try {
      const res = await request(app).get('/api/activities/bench-easy-60');
      expect(res.status).toBe(200);
      expect(res.body.activity).toBeDefined();
      expect(res.body.splits).toBeDefined();
      expect(res.body.records.length).toBeGreaterThan(0);
      expect(weatherFetch).not.toHaveBeenCalled();
    } finally {
      weatherFetch.mockRestore();
    }
  });

  it('PATCH /api/activities/:id updates custom title and tags', async () => {
    const patchRes = await request(app)
      .patch('/api/activities/bench-easy-60')
      .send({
        name: 'Morning Aerobic Base + PCN Strides',
        tags: ['Easy Base', 'Strides', 'Recovery']
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.activity.name).toBe('Morning Aerobic Base + PCN Strides');
    expect(JSON.parse(patchRes.body.activity.tags)).toEqual(['Easy Base', 'Strides', 'Recovery']);

    // Confirm persisted via GET
    const getRes = await request(app).get('/api/activities/bench-easy-60');
    expect(getRes.body.activity.name).toBe('Morning Aerobic Base + PCN Strides');
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

  it('GET /api/thresholds ignores marathon race activities when computing 5K benchmark', async () => {
    const db = getDatabase();
    // Insert a full marathon race activity (42195m, slow marathon pace 360s/km)
    db.prepare(`
      INSERT INTO activities (
        id, name, sport, start_time, duration_seconds, distance_meters,
        avg_pace_sec_km, avg_heart_rate, run_type, source_file_hash
      ) VALUES (
        'marathon-race-test', 'Standard Chartered Singapore Marathon', 'running', '2026-09-01 05:00:00',
        15190, 42195, 360, 155, 'race', 'marathon_hash_1'
      )
    `).run();

    const res = await request(app).get('/api/thresholds');
    expect(res.status).toBe(200);
    const pred5k = res.body.predictions.find((p: any) => p.distanceName === '5K');
    expect(pred5k).toBeDefined();
    // 5K prediction should be much faster than marathon pace (360s/km)
    expect(pred5k.paceSecKm).toBeLessThan(300);

    // Clean up
    db.prepare('DELETE FROM activities WHERE id = ?').run('marathon-race-test');
  });

  it('uses recorded race distance for benchmarks and ignores activity titles', async () => {
    const db = getDatabase();
    db.prepare(`INSERT INTO activities (id,name,start_time,run_type,distance_meters,duration_seconds,avg_pace_sec_km)
      VALUES ('named-benchmark','5k Time Trial','2026-09-30','easy_base',5000,1000,200)`).run();
    try {
      const named = (await request(app).get('/api/thresholds')).body.predictions;
      db.prepare("UPDATE activities SET name='Evening Running' WHERE id='named-benchmark'").run();
      expect((await request(app).get('/api/thresholds')).body.predictions).toEqual(named);
      db.prepare("UPDATE activities SET name='Evening Running', run_type='race', distance_meters=11000, avg_pace_sec_km=350 WHERE id='named-benchmark'").run();
      db.prepare(`INSERT INTO activity_intervals (activity_id,interval_index,type,start_seconds,duration_seconds,distance_meters,avg_pace_sec_km)
        VALUES ('named-benchmark',1,'work',1800,1000,5000,200)`).run();
      const race = await request(app).get('/api/thresholds');
      expect(race.status).toBe(200);
      expect(race.body.predictions.find((prediction: { distanceName: string }) => prediction.distanceName === '5K').paceSecKm).toBeLessThanOrEqual(200);
      db.prepare("UPDATE activities SET name='Recovery Failed MP Tempo' WHERE id='named-benchmark'").run();
      expect((await request(app).get('/api/thresholds')).body.predictions).toEqual(race.body.predictions);
    } finally {
      db.prepare("DELETE FROM activity_intervals WHERE activity_id='named-benchmark'").run();
      db.prepare("DELETE FROM activities WHERE id='named-benchmark'").run();
    }
  });

  it('persists AI coach summary in activity_coach_summaries table upon ingestion and returns it', async () => {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get('bench-easy-60') as any;
    expect(row).toBeDefined();
    expect(row.headline).toBe('Near-Perfect Aerobic Base Execution');
    expect(row.effectiveness_score).toBeGreaterThan(70);
    expect(row.key_insights_json).toBeDefined();

    // The weighted rubric and its coverage are persisted for the client
    const breakdown = JSON.parse(row.score_breakdown_json);
    expect(Array.isArray(breakdown)).toBe(true);
    expect(breakdown.every((f: any) => typeof f.maxPoints === 'number')).toBe(true);
    const analysis = JSON.parse(row.analysis_json);
    expect(analysis.rubricFamily).toBe('aerobic');
    expect(analysis.rubricCoveragePct).toBe(100);

    // Verify GET /api/activities/:id/coach-summary endpoint
    const res = await request(app).get('/api/activities/bench-easy-60/coach-summary');
    expect(res.status).toBe(200);
    expect(res.body.coachSummary.headline).toBe('Near-Perfect Aerobic Base Execution');
    expect(res.body.coachSummary.steadyHeartRate).toBeGreaterThan(0);
    expect(res.body.coachSummary.keyInsights.length).toBeGreaterThan(0);
    expect(res.body.coachSummary.rubricFamily).toBe('aerobic');
    expect(res.body.coachSummary.rubricCoveragePct).toBe(100);

    // Insight verdicts round-trip with the sentences they belong to
    expect(JSON.parse(row.insight_tones_json)).toHaveLength(res.body.coachSummary.keyInsights.length);
    expect(res.body.coachSummary.insightTones).toEqual(JSON.parse(row.insight_tones_json));
    expect(res.body.coachSummary.insightTones).toContain('positive');
  });

  it('continuously updates activity_coach_summaries when activity run_type is modified', async () => {
    const db = getDatabase();

    // Patch run_type to threshold_lt2
    const patchRes = await request(app)
      .patch('/api/activities/bench-easy-60')
      .send({ run_type: 'threshold_lt2' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.coachSummary).toBeDefined();
    // A steady aerobic run re-labelled as threshold scores poorly on the quality
    // rubric (no rep structure, no LT2 stimulus), and the headline says so.
    expect(patchRes.body.coachSummary.headline).toBe('Threshold Zone Not Verified');
    expect(patchRes.body.coachSummary.rubricFamily).toBe('quality');

    // Confirm the row in activity_coach_summaries was updated
    const row = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get('bench-easy-60') as any;
    expect(row.headline).toBe('Threshold Zone Not Verified');
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
    expect(res.body.zones.z4[1]).toBe(187);
    expect(res.body.zones.z5[0]).toBe(188);
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

  it('GET /api/profile correctly determines isConfigured based on is_configured flag and required baselines', async () => {
    const db = getDatabase();
    // Temporarily clear is_configured
    db.prepare("UPDATE athlete_profile SET is_configured = 0 WHERE id = 'primary'").run();
    const unconfiguredRes = await request(app).get('/api/profile');
    expect(unconfiguredRes.body.isConfigured).toBe(false);

    // Set is_configured = 1
    db.prepare("UPDATE athlete_profile SET is_configured = 1 WHERE id = 'primary'").run();
    const configuredRes = await request(app).get('/api/profile');
    expect(configuredRes.body.isConfigured).toBe(true);
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

    const fitBase64 = sealFit(Buffer.concat([header, payload])).toString('base64');

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

    const fitBase64 = sealFit(Buffer.concat([header, payload])).toString('base64');

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

  it('rejects malformed ZIP uploads with the documented response', async () => {
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: 'UEsDBA==', filename: 'garmin-export.zip' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ERR_ZIP_INVALID');
    expect(res.body.error).toContain('ZIP');
  });

  it('stores and returns a valid Garmin import folder and rejects invalid folder paths', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-ingest-settings-'));
    try {
      const saved = await request(app).post('/api/ingest/settings').send({ directory });
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({ directory: path.resolve(directory), exists: true });

      const loaded = await request(app).get('/api/ingest/settings');
      expect(loaded.status).toBe(200);
      expect(loaded.body).toEqual({ directory: path.resolve(directory), exists: true });

      const relative = await request(app).post('/api/ingest/settings').send({ directory: 'relative/path' });
      expect(relative.status).toBe(400);
      const missing = await request(app).post('/api/ingest/settings').send({ directory: path.join(directory, 'missing') });
      expect(missing.status).toBe(400);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects base64 CSV uploads without changing the history', async () => {
    const csv = `# Activity: Encoded Easy Run\n# Activity ID: base64-csv-upload\n# Date: 2026-09-20 07:00:00\n# Total Duration (s): 60\n# Total Distance (m): 200\n# Avg Heart Rate (bpm): 140\ntimestamp,heart_rate,cadence,speed,distance\n2026-09-20T07:00:00,140,170,3.3,0\n2026-09-20T07:01:00,140,170,3.3,200`;
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: Buffer.from(csv).toString('base64'), filename: 'encoded-run.csv' });

    expect(res.status).toBe(415);
    expect(res.body.code).toBe('ERR_IMPORT_FORMAT');
    expect(getDatabase().prepare('SELECT id FROM activities WHERE id = ?').get('base64-csv-upload')).toBeUndefined();
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

    const cycleBase64 = sealFit(Buffer.concat([header, cyclePayload])).toString('base64');
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

    const dataUri = `data:application/octet-stream;base64,${sealFit(Buffer.concat([header, payload])).toString('base64')}`;
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: dataUri, filename: 'data_uri_workout.fit', force: true });

    expect(res.status).toBe(200);
    expect(res.body.result.status).toBe('imported');
  });

  it('POST /api/ingest/upload rejects plain CSV uploads', async () => {
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({ content: '# comment only with no columns', filename: 'broken.csv' });

    expect(res.status).toBe(415);
    expect(res.body.code).toBe('ERR_IMPORT_FORMAT');
  });

  it('legacy migration helpers preserve Garmin CSV metadata comments', async () => {
    const content = `# Garmin Run Export — Parsed for AI Analysis
# Activity: Threshold
# Activity ID: garmin-commented-csv
# Date: 2026-09-24 19:02:28
# Total Distance (m): 1000
# Total Duration (s): 300
timestamp,heart_rate,cadence (spm),enhanced_speed,distance
2026-09-24T19:02:28.000,140,170,3.2,0
2026-09-24T19:07:28.000,155,175,3.2,1000`;
    const result = importRunContent(getDatabase(), content, 'threshold.csv');
    expect(result.status).toBe('imported');
    expect(result.activityId).toBe('garmin-commented-csv');
  });

  it('stores every telemetry sample with one workout coordinate for new imports', async () => {
    const rows = Array.from({ length: 120 }, (_, index) =>
      `${new Date(Date.UTC(2026, 8, 25, 12, 0, index)).toISOString()},145,170,3,${index * 3},${index === 0 ? 1.0 : 1.3},${index === 0 ? 103.0 : 103.8}`
    );
    const content = [
      '# Activity ID: full-telemetry-import',
      '# Date: 2026-09-25T12:00:00.000Z',
      '# Total Distance (m): 357',
      '# Total Duration (s): 119',
      'timestamp,heart_rate,cadence,speed,distance,position_lat,position_long',
      ...rows
    ].join('\n');
    const result = importRunContent(getDatabase(), content, 'full-telemetry.csv');
    expect(result.status).toBe('imported');
    const stored = getDatabase().prepare(
      'SELECT lat, lon FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds'
    ).all('full-telemetry-import') as Array<{ lat: number; lon: number }>;
    expect(stored).toHaveLength(rows.length);
    expect(stored[0]).toEqual({ lat: 1.3, lon: 103.8 });
    expect(stored.slice(1).every(record => record.lat === null && record.lon === null)).toBe(true);
  });

  it('GET /api/activities/training-load returns training status, acute/chronic load and optimal tunnel', async () => {
    const res = await request(app).get('/api/activities/training-load?days=30');
    expect(res.status).toBe(200);
    expect(res.body.trainingStatus).toBeDefined();
    expect(res.body.trainingStatus.currentAcuteLoad).toBeGreaterThanOrEqual(0);
    expect(res.body.trainingStatus.currentChronicLoad).toBeGreaterThanOrEqual(0);
    expect(res.body.trainingStatus.optimalRange).toBeDefined();
    expect(res.body.trainingStatus.timeline).toBeInstanceOf(Array);
  });

  it('GET /api/activities/best-efforts returns all-time and current year standard distance records', async () => {
    const res = await request(app).get('/api/activities/best-efforts');
    expect(res.status).toBe(200);
    expect(res.body.allTime).toBeInstanceOf(Array);
    expect(res.body.currentYear).toBeInstanceOf(Array);
    if (res.body.allTime.length > 0) {
      const record = res.body.allTime[0];
      expect(record.targetId).toBeDefined();
      expect(record.distanceMeters).toBeGreaterThan(0);
      expect(record.timeSeconds).toBeGreaterThan(0);
      expect(record.paceSecKm).toBeGreaterThan(0);
    }
  });

  it('GET /api/activities/best-efforts advertises 1k/5k/10k/HM/Marathon targets (no 1 Mile)', async () => {
    const res = await request(app).get('/api/activities/best-efforts');
    expect(res.status).toBe(200);
    expect(res.body.targets).toBeInstanceOf(Array);

    const ids = res.body.targets.map((t: any) => t.id);
    expect(ids).toEqual(['1k', '5k', '10k', 'hm', 'mar']);

    const marathon = res.body.targets.find((t: any) => t.id === 'mar');
    expect(marathon.label).toBe('Marathon');
    expect(marathon.distanceMeters).toBe(42195);
  });
});
