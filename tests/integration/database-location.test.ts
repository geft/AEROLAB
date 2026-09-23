import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/backend/server.js';
import { closeDatabase, getDatabase } from '../../src/backend/db/client.js';

describe('database location', () => {
  const previousAppData = process.env.APPDATA;
  const previousOverride = process.env.DATABASE_PATH;
  let root: string;
  let source: string;
  let app: ReturnType<typeof createServer>;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-location-'));
    process.env.APPDATA = root;
    delete process.env.DATABASE_PATH;
    source = path.join(root, 'source.db');
    const db = getDatabase(source);
    db.prepare(`INSERT INTO activities (id, source_filename, start_time, duration_seconds, distance_meters)
      VALUES ('location-test-run', 'test.fit', '2026-01-01T00:00:00Z', 1000, 3000)`).run();
    app = createServer();
  });

  afterAll(() => {
    closeDatabase();
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    if (previousOverride === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousOverride;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('copies a consistent snapshot to a new file and saves it for this build', async () => {
    const folder = path.join(root, 'external');
    fs.mkdirSync(folder);
    const destination = path.join(folder, 'training.db');
    const res = await request(app).post('/api/database/location').send({ databasePath: destination, expectedExists: false });
    expect(res.status).toBe(200);
    expect(res.body.databasePath).toBe(destination);
    expect(res.body.copied).toBe(true);
    expect(res.body.restartRequired).toBe(true);
    const copy = new Database(res.body.databasePath, { readonly: true });
    expect((copy.prepare('SELECT count(*) AS count FROM activities').get() as { count: number }).count).toBe(1);
    copy.close();
    expect(fs.existsSync(source)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'aerolab', 'development-database-location.json'), 'utf8')).databasePath)
      .toBe(destination);

    const repeat = await request(app).post('/api/database/location').send({ databasePath: destination, expectedExists: false });
    expect(repeat.status).toBe(409);
  });

  it('selects an existing database without copying over it', async () => {
    const res = await request(app).post('/api/database/location').send({ databasePath: source, expectedExists: true });
    expect(res.status).toBe(200);
    expect(res.body.copied).toBe(false);
    expect(res.body.databasePath).toBe(source);
  });

  it('rejects a non-database file as an existing location', async () => {
    const invalid = path.join(root, 'invalid.db');
    fs.writeFileSync(invalid, 'not a database');
    const res = await request(app).post('/api/database/location').send({ databasePath: invalid });
    expect(res.status).toBe(400);
  });
});
