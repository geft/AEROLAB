import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createServer } from '../../src/backend/server.js';
import { getDatabase, closeDatabase } from '../../src/backend/db/client.js';

describe('Database Restore & Auth Integration Tests', () => {
  let app: any;
  let testDir: string;
  let dbFilePath: string;
  let originalDbPath: string | undefined;

  beforeAll(() => {
    originalDbPath = process.env.DATABASE_PATH;
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-restore-test-'));
    dbFilePath = path.join(testDir, 'active-runs.db');
    process.env.DATABASE_PATH = dbFilePath;

    // Initialize base database with 1 activity
    const db = getDatabase(dbFilePath);
    db.prepare(`
      INSERT OR REPLACE INTO activities (
        id, source_filename, start_time, duration_seconds, distance_meters,
        avg_heart_rate, max_heart_rate, elevation_gain_m
      ) VALUES (
        'orig-run-1', 'orig.csv', '2026-09-01T08:00:00Z', 1800, 5000,
        145, 160, 20
      )
    `).run();

    app = createServer();
  });

  afterAll(() => {
    closeDatabase();
    if (originalDbPath !== undefined) {
      process.env.DATABASE_PATH = originalDbPath;
    } else {
      delete process.env.DATABASE_PATH;
    }
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch { /* best-effort cleanup: safe to ignore */ }
  });

  it('rejects invalid or non-database content in POST /api/database/restore', async () => {
    const fakeText = Buffer.from('This is not a SQLite database file').toString('base64');
    const res = await request(app)
      .post('/api/database/restore')
      .send({ base64: fakeText });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('SQLite');
  });

  it('restores a valid database snapshot and replaces active activities', async () => {
    // 1. Create a donor database in a separate file with 3 distinct activities
    const donorPath = path.join(testDir, 'donor-source.db');
    const donorDb = getDatabase(donorPath);
    donorDb.prepare(`
      INSERT OR REPLACE INTO activities (
        id, source_filename, start_time, duration_seconds, distance_meters,
        avg_heart_rate, max_heart_rate, elevation_gain_m
      ) VALUES
        ('donor-1', 'd1.csv', '2026-09-10T08:00:00Z', 1200, 3000, 140, 155, 10),
        ('donor-2', 'd2.csv', '2026-09-11T08:00:00Z', 2400, 6000, 150, 168, 30),
        ('donor-3', 'd3.csv', '2026-09-12T08:00:00Z', 3600, 10000, 155, 172, 45);
    `).run();
    closeDatabase();
    getDatabase(dbFilePath);

    const donorBuffer = fs.readFileSync(donorPath);
    const donorBase64 = donorBuffer.toString('base64');

    // 2. Call restore endpoint
    const res = await request(app)
      .post('/api/database/restore')
      .send({ base64: donorBase64 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.activityCount).toBe(3);

    // 3. Verify active DB now contains the 3 donor activities
    const activeDb = getDatabase();
    const count = (activeDb.prepare('SELECT count(*) as c FROM activities').get() as any).c;
    expect(count).toBe(3);
  });
});
