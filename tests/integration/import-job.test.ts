import { decodeSourceFit } from '../../src/backend/db/compression.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { getDatabase, closeDatabase, openDatabase } from '../../src/backend/db/client.js';
import { createServer } from '../../src/backend/server.js';
import { getImportJob, cancelImportJob } from '../../src/backend/jobs/import-job.js';
import { importParsedRun } from '../../src/backend/ingestion/importer.js';
import { parseRunFit } from '../../src/backend/ingestion/fit-parser.js';
import { realignDatabase } from '../../src/backend/db/realign.js';
import { fitFile, message, START } from '../fixtures/fit-binary.mjs';

function runFit(day: number, hr: number) {
  const start = START + day * 86400;
  return fitFile([
    message(0, [[0, 0, 4], [1, 0x84, 1], [3, 0x8c, 123456], [4, 0x86, start]]),
    ...Array.from({ length: 601 }, (_, second) => message(20, [[253, 0x86, start + second], [3, 2, hr], [4, 2, 85],
      [5, 0x86, second * 300], [73, 0x86, 3000], [39, 0x84, 800], [41, 0x84, 2400], [85, 0x84, 10000]])),
    message(18, [[253, 0x86, start + 600], [2, 0x86, start], [5, 0, 1], [7, 0x86, 600000], [8, 0x86, 600000],
      [9, 0x86, 180000], [16, 2, hr], [17, 2, hr], [18, 2, 85]]),
  ]);
}
const read = (db: Database.Database) => ({
  runs: db.prepare('SELECT id,run_type,efficiency_factor,aerobic_decoupling_pct,training_load,z1_seconds,z2_seconds,z3_seconds,z4_seconds,z5_seconds FROM activities ORDER BY id').all(),
  intervals: db.prepare('SELECT activity_id,type,start_seconds,duration_seconds FROM activity_intervals ORDER BY activity_id,interval_index').all(),
  summaries: db.prepare('SELECT activity_id,effectiveness_score,analysis_json FROM activity_coach_summaries ORDER BY activity_id').all()
});

describe('background import jobs with real decoding workers', () => {
  let directory: string;
  let db: Database.Database;
  let app: ReturnType<typeof createServer>;
  let jobId: string | undefined;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-job-test-'));
    db = getDatabase(path.join(directory, 'runs.db'));
    db.prepare("UPDATE athlete_profile SET max_hr=190,resting_hr=50,is_max_hr_estimated=0 WHERE id='primary'").run();
    app = createServer();
  });
  afterEach(async () => {
    if (jobId && getImportJob(jobId).phase === 'uploading') await cancelImportJob(jobId);
    closeDatabase();
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('aerolab-job-test-')) throw new Error('Unsafe test cleanup');
    fs.rmSync(directory, { recursive: true, force: true });
    jobId = undefined;
  });
  async function start(totalFiles: number, force = false) {
    const response = await request(app).post('/api/ingest/jobs').send({ totalFiles, force });
    expect(response.status).toBe(201);
    jobId = response.body.jobId;
    return jobId!;
  }
  async function waitForJob() {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const status = getImportJob(jobId!);
      if (status.phase === 'complete' || status.phase === 'failed') return status;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Import job timed out');
  }

  it('decodes out of order, replays the whole job once, and matches serial analysis', async () => {
    const files = [3, 1, 2].map(day => ({ filename: `${day}.fit`, content: runFit(day, day === 1 ? 170 : 153).toString('base64') }));
    db.exec(`CREATE TABLE replay_counts(activity_id TEXT);
      CREATE TRIGGER count_job_replay AFTER UPDATE OF run_type ON activities BEGIN INSERT INTO replay_counts VALUES(NEW.id); END;`);
    const id = await start(files.length);
    expect((await request(app).post(`/api/ingest/jobs/${id}/files`).send({ files: files.slice(0, 2) })).status).toBe(200);
    expect((await request(app).post(`/api/ingest/jobs/${id}/files`).send({ files: files.slice(2) })).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) n FROM activities').get()).toEqual({ n: 0 });
    expect((await request(app).post(`/api/ingest/jobs/${id}/finish`).send({})).status).toBe(202);
    expect((await request(app).get('/api/health')).status).toBe(200);
    const result = await waitForJob();
    expect(result.phase).toBe('complete');
    expect(result.results?.map(item => item.status)).toEqual(['imported', 'imported', 'imported']);
    expect(db.prepare('SELECT COUNT(*) n FROM replay_counts').get()).toEqual({ n: 3 });
    expect(db.prepare('SELECT COUNT(*) n FROM activity_fit_details WHERE source_fit IS NOT NULL').get()).toEqual({ n: 3 });
    expect(decodeSourceFit((db.prepare('SELECT source_fit FROM activity_fit_details WHERE activity_id=?').get(result.results![0].activityId) as { source_fit: Buffer }).source_fit))
      .toEqual(Buffer.from(files[0].content, 'base64'));
    const reference = openDatabase(':memory:');
    try {
      reference.prepare("UPDATE athlete_profile SET max_hr=190,resting_hr=50,is_max_hr_estimated=0 WHERE id='primary'").run();
      for (const file of files) expect(importParsedRun(reference, parseRunFit(Buffer.from(file.content, 'base64'), file.filename)!, file.filename).status).toBe('imported');
      realignDatabase(reference);
      expect(read(db)).toEqual(read(reference));
    } finally { reference.close(); }
  }, 30000);

  it('keeps parse errors per file, skips duplicates, and honours overwrite', async () => {
    const file = { filename: 'run.fit', content: runFit(1, 140).toString('base64') };
    let id = await start(2);
    await request(app).post(`/api/ingest/jobs/${id}/files`).send({ files: [file, { filename: 'bad.fit', content: 'AA==' }] });
    await request(app).post(`/api/ingest/jobs/${id}/finish`).send({});
    expect((await waitForJob()).results?.map(item => item.status)).toEqual(['imported', 'error']);
    id = await start(1);
    await request(app).post(`/api/ingest/jobs/${id}/files`).send({ files: [file] });
    await request(app).post(`/api/ingest/jobs/${id}/finish`).send({});
    expect((await waitForJob()).results?.[0].status).toBe('skipped_duplicate');
    db.prepare('UPDATE activity_records SET step_length_m=NULL').run();
    id = await start(1, true);
    await request(app).post(`/api/ingest/jobs/${id}/files`).send({ files: [file] });
    await request(app).post(`/api/ingest/jobs/${id}/finish`).send({});
    expect((await waitForJob()).results?.[0].status).toBe('imported');
    expect(db.prepare('SELECT COUNT(*) n FROM activity_records WHERE step_length_m IS NOT NULL').get()).toEqual({ n: 601 });
  }, 30000);

  it('blocks conflicting writes, permits reads, validates chunks, and cancels staging without database changes', async () => {
    expect((await request(app).post('/api/ingest/jobs').send({ totalFiles: 0 })).status).toBe(400);
    const id = await start(2);
    expect((await request(app).post('/api/ingest/jobs').send({ totalFiles: 1 })).status).toBe(409);
    expect((await request(app).patch('/api/profile').send({})).status).toBe(409);
    expect((await request(app).get('/api/activities')).status).toBe(200);
    expect((await request(app).post(`/api/ingest/jobs/${id}/files`).send({ files: [null] })).status).toBe(400);
    expect((await request(app).post(`/api/ingest/jobs/${id}/finish`).send({})).status).toBe(409);
    expect((await request(app).delete(`/api/ingest/jobs/${id}`)).status).toBe(200);
    expect((await request(app).patch('/api/profile').send({})).status).not.toBe(409);
    expect(db.prepare('SELECT COUNT(*) n FROM activities').get()).toEqual({ n: 0 });
  });

  it('rolls back every imported file if the final chronological replay fails', async () => {
    db.exec(`CREATE TRIGGER fail_job_replay BEFORE UPDATE OF run_type ON activities BEGIN SELECT RAISE(ABORT,'job replay failure'); END;`);
    const id = await start(2);
    const files = [1, 2].map(day => ({ filename: `${day}.fit`, content: runFit(day, 140).toString('base64') }));
    await request(app).post(`/api/ingest/jobs/${id}/files`).send({ files });
    await request(app).post(`/api/ingest/jobs/${id}/finish`).send({});
    const result = await waitForJob();
    expect(result).toMatchObject({ phase: 'failed', error: expect.stringContaining('job replay failure') });
    expect(db.prepare('SELECT COUNT(*) n FROM activities').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM activity_records').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) n FROM activity_fit_details').get()).toEqual({ n: 0 });
  }, 30000);

  it('can finalize fewer files after client read failures, but rejects an inconsistent file count', async () => {
    const id = await start(2);
    await request(app).post(`/api/ingest/jobs/${id}/files`).send({ files: [{ filename: 'bad.fit', content: 'AA==' }] });
    expect((await request(app).post(`/api/ingest/jobs/${id}/finish`).send({ totalFiles: 2 })).status).toBe(409);
    expect((await request(app).post(`/api/ingest/jobs/${id}/finish`).send({ totalFiles: 1 })).status).toBe(202);
    expect((await waitForJob()).results?.map(item => item.status)).toEqual(['error']);
    expect(db.prepare('SELECT COUNT(*) n FROM activities').get()).toEqual({ n: 0 });
  }, 30000);
});
