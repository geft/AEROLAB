import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { zipSync } from 'fflate';
import { richFit } from '../fixtures/fit-binary.mjs';
import { createServer } from '../../src/backend/server.js';
import { getDatabase } from '../../src/backend/db/client.js';
import {
  decodeGarminTokenClaims,
  garminKeyExpiryFromToken,
  resetGarminTokenCache
} from '../../src/backend/garmin/client.js';
import {
  clearStoredGarminCredentials,
  getGarminKeyStatus,
  saveGarminApiKey,
  saveGarminKeyExpiry
} from '../../src/backend/garmin/credentials.js';
import { planGarminBatch } from '../../src/backend/garmin/sync.js';
import type { GarminActivitySummary } from '../../src/backend/garmin/client.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.signature`;
}

function activity(
  id: string,
  time: string | null,
  typeKey = 'running'
): GarminActivitySummary {
  return {
    activityId: id,
    activityName: `Run ${id}`,
    startTimeLocal: time,
    startTimeGmt: null,
    activityTypeKey: typeKey,
    distanceMeters: 10_000,
    isManual: false
  };
}

describe('Garmin Personal API helpers', () => {
  it('decodes exp and iat from an access token', () => {
    const claims = decodeGarminTokenClaims(jwt({ exp: 1_800_000_000, iat: 1_799_913_600 }));
    expect(claims.expiresAt).toBe(1_800_000_000_000);
    expect(claims.issuedAt).toBe(1_799_913_600_000);
  });

  it('returns null claims for a malformed token', () => {
    expect(decodeGarminTokenClaims('not-a-jwt')).toEqual({ expiresAt: null, issuedAt: null });
  });

  it('infers a key expiry only when the token lifetime is shortened', () => {
    const issuedAt = 1_800_000_000 * 1000;
    expect(garminKeyExpiryFromToken({
      accessToken: 'token',
      issuedAt,
      expiresAt: issuedAt + 24 * 60 * 60 * 1000
    })).toBeNull();
    expect(garminKeyExpiryFromToken({
      accessToken: 'token',
      issuedAt,
      expiresAt: issuedAt + 60 * 60 * 1000
    })).toBe(new Date(issuedAt + 60 * 60 * 1000).toISOString());
  });

  it('plans newer runs oldest-first so gaps fill contiguously', () => {
    const plan = planGarminBatch({
      newer: [
        activity('newest', '2026-10-12 08:00:00'),
        activity('middle', '2026-10-11 08:00:00'),
        activity('existing', '2026-10-10 08:00:00')
      ],
      older: [],
      latestLocal: '2026-10-10 08:00:00',
      oldestLocal: '2025-01-01 08:00:00',
      backfillBefore: null,
      limit: 1
    });
    expect(plan.candidates.map(candidate => candidate.activity.activityId)).toEqual(['middle']);
    expect(plan.candidates[0].direction).toBe('newer');
    expect(plan.hasMoreNewer).toBe(true);
    expect(plan.hasMoreOlder).toBe(false);
  });

  it('backs off older runs from the cursor and skips non-running activities', () => {
    const plan = planGarminBatch({
      newer: [],
      older: [
        activity('lift', '2025-06-10 08:00:00', 'strength_training'),
        activity('oldest-local', '2025-06-01 08:00:00'),
        activity('older-1', '2025-05-30 08:00:00'),
        activity('older-2', '2025-05-20 08:00:00'),
        activity('no-time', null)
      ],
      latestLocal: null,
      oldestLocal: '2025-06-01 08:00:00',
      backfillBefore: '2025-06-01 08:00:00',
      limit: 1
    });
    expect(plan.candidates.map(candidate => candidate.activity.activityId)).toEqual(['older-1']);
    expect(plan.candidates[0].direction).toBe('older');
    expect(plan.hasMoreOlder).toBe(true);
  });
});

describe('Garmin credential storage', () => {
  const credentialsPath = path.join(os.tmpdir(), `aerolab-garmin-credentials-${randomUUID()}.json`);

  beforeAll(() => {
    process.env.AEROLAB_GARMIN_CREDENTIALS_PATH = credentialsPath;
    delete process.env.GARMIN_API_KEY;
    delete process.env.GARMIN_API_KEY_EXPIRY;
    clearStoredGarminCredentials();
  });

  afterEach(() => {
    clearStoredGarminCredentials();
    delete process.env.GARMIN_API_KEY;
    delete process.env.GARMIN_API_KEY_EXPIRY;
  });

  afterAll(() => {
    delete process.env.AEROLAB_GARMIN_CREDENTIALS_PATH;
  });

  it('reports a stored key that expires within the warning window', () => {
    saveGarminApiKey('test-key-123456', new Date(Date.now() + 10 * DAY_MS).toISOString());
    const status = getGarminKeyStatus();
    expect(status.configured).toBe(true);
    expect(status.source).toBe('stored');
    expect(status.expiringSoon).toBe(true);
    expect(status.expired).toBe(false);
  });

  it('removes a stored key that has already expired', () => {
    saveGarminApiKey('test-key-123456', new Date(Date.now() - DAY_MS).toISOString());
    const status = getGarminKeyStatus();
    expect(status.configured).toBe(false);
    expect(status.expired).toBe(true);
    expect(fs.existsSync(credentialsPath)).toBe(false);
  });

  it('falls back to the environment key when nothing is stored', () => {
    process.env.GARMIN_API_KEY = 'environment-key-123456';
    const status = getGarminKeyStatus();
    expect(status.configured).toBe(true);
    expect(status.source).toBe('environment');
    expect(status.expiresAt).toBeNull();
  });

  it('records an expiry for an environment key without writing the key', () => {
    process.env.GARMIN_API_KEY = 'environment-key-123456';
    saveGarminKeyExpiry(new Date(Date.now() + 10 * DAY_MS).toISOString());
    const status = getGarminKeyStatus();
    expect(status.configured).toBe(true);
    expect(status.source).toBe('environment');
    expect(status.expiringSoon).toBe(true);
    const raw = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) as Record<string, unknown>;
    expect(raw.apiKey).toBeNull();
    expect(raw.expiresAt).not.toBeNull();
  });

  it('keeps an environment key configured after its recorded expiry passes', () => {
    process.env.GARMIN_API_KEY = 'environment-key-123456';
    saveGarminKeyExpiry(new Date(Date.now() - DAY_MS).toISOString());
    const status = getGarminKeyStatus();
    expect(status.configured).toBe(true);
    expect(status.source).toBe('environment');
    expect(status.expired).toBe(true);
    expect(status.expiresAt).toBeNull();
    expect(fs.existsSync(credentialsPath)).toBe(false);
  });

  it('uses GARMIN_API_KEY_EXPIRY without writing any credentials file', () => {
    process.env.GARMIN_API_KEY = 'environment-key-123456';
    process.env.GARMIN_API_KEY_EXPIRY = '2027-10-22';
    const status = getGarminKeyStatus(Date.parse('2026-10-22T12:00:00Z'));
    expect(status.configured).toBe(true);
    expect(status.source).toBe('environment');
    expect(status.expirySource).toBe('environment');
    expect(status.expiresAt).not.toBeNull();
    expect(status.expiringSoon).toBe(false);
    expect(fs.existsSync(credentialsPath)).toBe(false);
  });

  it('warns from GARMIN_API_KEY_EXPIRY when the key is within a month of expiry', () => {
    process.env.GARMIN_API_KEY = 'environment-key-123456';
    process.env.GARMIN_API_KEY_EXPIRY = '2026-11-10';
    const status = getGarminKeyStatus(Date.parse('2026-10-22T12:00:00Z'));
    expect(status.expirySource).toBe('environment');
    expect(status.expiringSoon).toBe(true);
    expect(status.expired).toBe(false);
    expect(fs.existsSync(credentialsPath)).toBe(false);
  });

  it('reports an expired GARMIN_API_KEY_EXPIRY but keeps the environment key configured', () => {
    process.env.GARMIN_API_KEY = 'environment-key-123456';
    process.env.GARMIN_API_KEY_EXPIRY = '2026-01-01';
    const status = getGarminKeyStatus(Date.parse('2026-10-22T12:00:00Z'));
    expect(status.configured).toBe(true);
    expect(status.expired).toBe(true);
    expect(status.expirySource).toBe('environment');
    expect(fs.existsSync(credentialsPath)).toBe(false);
  });

  it('does not mirror GARMIN_API_KEY_EXPIRY to disk when the expiry is saved', () => {
    process.env.GARMIN_API_KEY = 'environment-key-123456';
    process.env.GARMIN_API_KEY_EXPIRY = '2027-10-22';
    saveGarminKeyExpiry('2028-01-01');
    expect(fs.existsSync(credentialsPath)).toBe(false);
    expect(getGarminKeyStatus().expirySource).toBe('environment');
  });
});

describe('Garmin Personal API routes', () => {
  const credentialsPath = path.join(os.tmpdir(), `aerolab-garmin-routes-${randomUUID()}.json`);
  const accessToken = jwt({ exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, iat: Math.floor(Date.now() / 1000) });
  const fitZip = Buffer.from(zipSync({ 'activity.fit': new Uint8Array(richFit()) }));
  let app: ReturnType<typeof createServer>;

  beforeAll(() => {
    process.env.AEROLAB_GARMIN_CREDENTIALS_PATH = credentialsPath;
    delete process.env.GARMIN_API_KEY;
    delete process.env.GARMIN_API_KEY_EXPIRY;
    app = createServer();
  });

  beforeEach(() => {
    clearStoredGarminCredentials();
    resetGarminTokenCache();
    delete process.env.GARMIN_API_KEY;
    delete process.env.GARMIN_API_KEY_EXPIRY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GARMIN_API_KEY;
    delete process.env.GARMIN_API_KEY_EXPIRY;
  });

  afterAll(() => {
    clearStoredGarminCredentials();
    delete process.env.AEROLAB_GARMIN_CREDENTIALS_PATH;
  });

  it('reports no key when nothing is configured', async () => {
    const response = await request(app).get('/api/ingest/garmin/status').expect(200);
    expect(response.body.key.configured).toBe(false);
    expect(response.body.key.source).toBeNull();
  });

  it('validates and stores a key against the token endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      expect(String(input)).toContain('/personal-api-key/token');
      return new Response(accessToken, { status: 200 });
    }));

    const saved = await request(app)
      .put('/api/ingest/garmin/key')
      .send({ apiKey: 'test-key-123456', expiresAt: '2027-10-22' })
      .expect(200);
    expect(saved.body.key.configured).toBe(true);
    expect(saved.body.key.source).toBe('stored');
    expect(saved.body.key.expiresAt).not.toBeNull();
    expect(saved.body.key.expiringSoon).toBe(false);

    const status = await request(app).get('/api/ingest/garmin/status').expect(200);
    expect(status.body.key.configured).toBe(true);
  });

  it('rejects an invalid key without storing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    const response = await request(app)
      .put('/api/ingest/garmin/key')
      .send({ apiKey: 'invalid-key-123456' })
      .expect(401);
    expect(response.body.code).toBe('GARMIN_KEY_INVALID');
    expect(getGarminKeyStatus().configured).toBe(false);
  });

  it('updates the expiry of a saved key without re-entering it', async () => {
    saveGarminApiKey('test-key-123456', null);
    const response = await request(app)
      .put('/api/ingest/garmin/key')
      .send({ apiKey: '', expiresAt: '2027-01-01' })
      .expect(200);
    expect(response.body.key.configured).toBe(true);
    expect(response.body.key.expiresAt).not.toBeNull();
  });

  it('records an expiry for an environment key without storing the key', async () => {
    process.env.GARMIN_API_KEY = 'environment-key-123456';
    const response = await request(app)
      .put('/api/ingest/garmin/key')
      .send({ apiKey: '', expiresAt: '2027-01-01' })
      .expect(200);
    expect(response.body.key.source).toBe('environment');
    expect(response.body.key.expirySource).toBe('stored');
    expect(response.body.key.expiresAt).not.toBeNull();
    const raw = JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) as Record<string, unknown>;
    expect(raw.apiKey).toBeNull();
  });

  it('uses GARMIN_API_KEY_EXPIRY for status and never creates a credentials file', async () => {
    process.env.GARMIN_API_KEY = 'environment-key-123456';
    process.env.GARMIN_API_KEY_EXPIRY = '2027-10-22';

    const status = await request(app).get('/api/ingest/garmin/status').expect(200);
    expect(status.body.key.source).toBe('environment');
    expect(status.body.key.expirySource).toBe('environment');
    expect(status.body.key.expiresAt).not.toBeNull();

    const saved = await request(app)
      .put('/api/ingest/garmin/key')
      .send({ apiKey: '', expiresAt: '2028-01-01' })
      .expect(200);
    expect(saved.body.key.expirySource).toBe('environment');
    expect(fs.existsSync(credentialsPath)).toBe(false);
  });

  it('removes a saved key when Garmin rejects it during a sync', async () => {
    saveGarminApiKey('test-key-123456', null);
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/personal-api-key/token')) return new Response(accessToken, { status: 200 });
      return new Response('', { status: 401 });
    }));

    const response = await request(app).post('/api/ingest/garmin/sync').send({}).expect(401);
    expect(response.body.code).toBe('GARMIN_KEY_INVALID');
    expect(getGarminKeyStatus().configured).toBe(false);
  });

  it('downloads and imports a FIT file from a Garmin activity', async () => {
    saveGarminApiKey('test-key-123456', null);
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/personal-api-key/token')) return new Response(accessToken, { status: 200 });
      if (url.includes('/activitylist-service/activities/search/activities')) {
        return new Response(JSON.stringify([{
          activityId: 987654,
          activityName: 'Imported Garmin run',
          startTimeLocal: '2026-10-20 07:00:00',
          activityType: { typeKey: 'running' },
          distance: 10000
        }]), { status: 200 });
      }
      if (url.includes('/download-service/files/activity/987654')) {
        return new Response(new Uint8Array(fitZip), { status: 200 });
      }
      throw new Error(`Unexpected Garmin request: ${url}`);
    }));

    const response = await request(app).post('/api/ingest/garmin/sync').send({}).expect(200);
    expect(response.body.errors).toBe(0);
    expect(response.body.imported).toBe(1);
    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].status).toBe('imported');

    const stored = getDatabase().prepare('SELECT COUNT(*) AS count FROM activities').get() as { count: number };
    expect(stored.count).toBe(1);
  });

  it('skips an activity Garmin has no file for instead of reporting an error', async () => {
    saveGarminApiKey('test-key-123456', null);
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/personal-api-key/token')) return new Response(accessToken, { status: 200 });
      if (url.includes('/activitylist-service/activities/search/activities')) {
        return new Response(JSON.stringify([{
          activityId: 555001,
          activityName: 'Manual entry',
          startTimeLocal: '2026-10-21 07:00:00',
          activityType: { typeKey: 'running' },
          distance: 10000
        }]), { status: 200 });
      }
      // Garmin answers 404 for a manual activity: it has no recorded file.
      return new Response('', { status: 404 });
    }));

    const response = await request(app).post('/api/ingest/garmin/sync').send({}).expect(200);
    expect(response.body.results).toHaveLength(1);
    expect(response.body.results[0].status).toBe('skipped_no_file');
    expect(response.body.noFile).toBe(1);
    expect(response.body.errors).toBe(0);
    expect(response.body.imported).toBe(0);
  });

  it('skips a manual activity without asking Garmin for a file', async () => {
    saveGarminApiKey('test-key-123456', null);
    const db = getDatabase();
    // A local run newer than the Garmin entry makes it a backfill candidate.
    db.prepare(`INSERT OR REPLACE INTO activities (id, start_time, distance_meters, duration_seconds)
      VALUES ('local-newest-manual', '2026-10-22 07:00:00', 5000, 1500)`).run();
    db.prepare("INSERT OR IGNORE INTO athlete_profile (id) VALUES ('primary')").run();
    db.prepare("UPDATE athlete_profile SET preferences_json = '{}' WHERE id = 'primary'").run();

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/personal-api-key/token')) return new Response(accessToken, { status: 200 });
      if (url.includes('/activitylist-service/activities/search/activities')) {
        return new Response(JSON.stringify([{
          activityId: 555003,
          activityName: 'Garmin 10k 2026 - Chip Time',
          startTimeLocal: '2025-01-01 07:00:00',
          activityType: { typeKey: 'running' },
          distance: 10000,
          isManualActivity: true,
          manualActivity: true
        }]), { status: 200 });
      }
      throw new Error(`Unexpected Garmin request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(app).post('/api/ingest/garmin/sync').send({}).expect(200);
    expect(response.body.results[0].status).toBe('skipped_no_file');
    expect(response.body.noFile).toBe(1);
    expect(response.body.errors).toBe(0);
    expect(response.body.imported).toBe(0);
    expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/download-service/files/activity/')))
      .toBe(false);

    const row = db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'")
      .get() as { preferences_json: string } | undefined;
    expect(JSON.parse(row!.preferences_json).garminBackfillBefore).toBe('2025-01-01 07:00:00');
  });

  it('moves the backfill cursor past an activity with no file', async () => {
    saveGarminApiKey('test-key-123456', null);
    const db = getDatabase();
    // A local run newer than the Garmin entry makes it a backfill candidate.
    db.prepare(`INSERT OR REPLACE INTO activities (id, start_time, distance_meters, duration_seconds)
      VALUES ('local-newest', '2026-10-22 07:00:00', 5000, 1500)`).run();
    // Start from an empty cursor so a value left by an earlier sync cannot mask
    // whether this one moved it.
    db.prepare("INSERT OR IGNORE INTO athlete_profile (id) VALUES ('primary')").run();
    db.prepare("UPDATE athlete_profile SET preferences_json = '{}' WHERE id = 'primary'").run();

    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/personal-api-key/token')) return new Response(accessToken, { status: 200 });
      if (url.includes('/activitylist-service/activities/search/activities')) {
        return new Response(JSON.stringify([{
          activityId: 555002,
          activityName: 'Manual entry',
          startTimeLocal: '2025-01-01 07:00:00',
          activityType: { typeKey: 'running' },
          distance: 10000
        }]), { status: 200 });
      }
      return new Response('', { status: 404 });
    }));

    const response = await request(app).post('/api/ingest/garmin/sync').send({}).expect(200);
    expect(response.body.results[0].status).toBe('skipped_no_file');
    expect(response.body.olderFound).toBe(1);

    const row = db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'")
      .get() as { preferences_json: string } | undefined;
    expect(JSON.parse(row!.preferences_json).garminBackfillBefore).toBe('2025-01-01 07:00:00');
  });
});
