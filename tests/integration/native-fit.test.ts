import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { zipSync } from 'fflate';
import { openDatabase, getDatabase, closeDatabase } from '../../src/backend/db/client.js';
import { createServer } from '../../src/backend/server.js';
import { importParsedRun, importDirectory } from '../../src/backend/ingestion/importer.js';
import { parseRunFit, convertFitToCsv } from '../../src/backend/ingestion/fit-parser.js';
import { parseRunCSV } from '../../src/backend/ingestion/csv-parser.js';
import { sessionToCsv } from '../../src/frontend/utils/sessionCsv.js';
import { richFit, fitFile, message, START } from '../fixtures/fit-binary.mjs';
import type { Activity, ActivityRecord } from '../../src/frontend/types/api.js';

describe('native FIT and Garmin ZIP ingestion', () => {
  afterEach(() => closeDatabase());

  it('native FIT and optional CSV have the same metrics, metadata and units', () => {
    const fit = richFit();
    const native = parseRunFit(fit, 'run.fit')!;
    const csv = parseRunCSV(convertFitToCsv(fit, 'run.fit').csv!, 'run.csv');
    expect(native.metadata).toEqual(csv.metadata);
    expect(native.fitMetadata).toEqual(csv.fitMetadata);
    const withoutRawFields = (record: typeof native.records[number]) => {
      const { fitFields: _fitFields, ...metrics } = record;
      return metrics;
    };
    expect(native.records.map(withoutRawFields)).toEqual(csv.records.map(withoutRawFields));
    expect(native.records[0]).toMatchObject({ power: 300, stepLength: 1.1, verticalRatio: 7.5, stanceTimeBalance: 50.2, stanceTime: 245, respirationRate: 28.5, coreTemperature: 38.1, cadence: 170.5 });
    expect(native.records[0].fitFields?.developer_fields).toEqual({ 0: 300 });
    expect(native.sourceFit).toEqual(fit);
  });

  it('persists original FIT, every extra metric and structured messages; CSV button preserves them', () => {
    const db = openDatabase(':memory:');
    try {
      const fit = richFit();
      const parsed = parseRunFit(fit, 'run.fit')!;
      expect(importParsedRun(db, parsed, 'run.fit').status).toBe('imported');
      const stored = db.prepare('SELECT * FROM activity_fit_details').get() as { metadata_json: string; source_fit: Buffer };
      expect(stored.source_fit).toEqual(fit);
      const metadata = JSON.parse(stored.metadata_json);
      expect(metadata.laps).toHaveLength(1);
      expect(metadata.events).toHaveLength(4);
      expect(metadata.workoutSteps).toHaveLength(1);
      expect(metadata.hrv[0].time).toEqual([0.8, 0.81, 0.79]);
      expect(metadata.session).toMatchObject({ workout_rpe: 60, workout_feel: 75 });
      const records = db.prepare('SELECT * FROM activity_records ORDER BY elapsed_seconds').all() as ActivityRecord[];
      expect(records[0]).toMatchObject({ power_w: 300, vertical_ratio: 7.5, stance_time_balance: 50.2, step_length_m: 1.1 });
      const activity = db.prepare('SELECT * FROM activities').get() as Activity;
      const exported = parseRunCSV(sessionToCsv(activity, records, metadata), 'ai-analysis.csv');
      expect(exported.fitMetadata).toEqual(metadata);
      expect(exported.records[0]).toMatchObject({ power: 300, stepLength: 1.1, stanceTimeBalance: 50.2 });
      expect(exported.records[0].fitFields).toMatchObject({ developer_fields: { 0: 300 }, power_source: 'developer:0:0' });
      expect(exported.records[0].fitFields).not.toHaveProperty('fit_fields');
      expect(importParsedRun(db, exported, 'ai-analysis.csv', { force: true }).status).toBe('imported');
      expect((db.prepare('SELECT source_fit FROM activity_fit_details').get() as { source_fit: Buffer }).source_fit).toEqual(fit);
    } finally { db.close(); }
  });

  it('uploads ZIP, exposes metadata, and deduplicates its extracted FIT by original bytes', async () => {
    process.env.DATABASE_PATH = ':memory:';
    getDatabase(':memory:');
    const app = createServer();
    const fit = richFit();
    const zip = zipSync({ 'activity/activity.fit': fit });
    const upload = await request(app).post('/api/ingest/upload').send({ content: Buffer.from(zip).toString('base64'), filename: 'garmin.zip' });
    expect(upload.status).toBe(200);
    expect(upload.body.result.status).toBe('imported');
    const detail = await request(app).get(`/api/activities/${upload.body.result.activityId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.fitMetadata.events).toHaveLength(4);
    const duplicate = await request(app).post('/api/ingest/upload').send({ content: fit.toString('base64'), filename: 'run.fit' });
    expect(duplicate.body.result.status).toBe('skipped_duplicate');
    const bad = await request(app).post('/api/ingest/upload').send({ content: 'UEsDBA==', filename: 'bad.zip' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('ERR_ZIP_INVALID');
  });

  it('folder import accepts ZIP alongside FIT and ignores CSV exports', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-fit-zip-'));
    const db = openDatabase(':memory:');
    try {
      const fit = richFit();
      fs.writeFileSync(path.join(directory, 'run.zip'), zipSync({ 'run.fit': fit }));
      fs.writeFileSync(path.join(directory, 'run.fit'), fit);
      fs.writeFileSync(path.join(directory, 'notes.txt'), 'ignore');
      fs.writeFileSync(path.join(directory, 'export.csv'), 'timestamp,heart_rate\n1,140');
      const results = importDirectory(db, directory);
      expect(results.map(result => result.status).sort()).toEqual(['imported', 'skipped_duplicate']);
    } finally {
      db.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('selects the running session in a multisport FIT instead of mixing cycling records', () => {
    const fit = fitFile([
      message(20, [[253, 0x86, START], [3, 2, 110], [73, 0x86, 9000]]),
      message(18, [[2, 0x86, START], [5, 0, 2], [7, 0x86, 60000], [8, 0x86, 60000]]),
      message(20, [[253, 0x86, START + 61], [3, 2, 150], [73, 0x86, 3000]]),
      message(18, [[2, 0x86, START + 61], [5, 0, 1], [7, 0x86, 60000], [8, 0x86, 60000]]),
    ]);
    expect(parseRunFit(fit, 'multisport.fit')!.records).toMatchObject([{ heartRate: 150, speedMps: 3 }]);
  });
});
