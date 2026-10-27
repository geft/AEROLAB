import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { createServer } from '../../src/backend/server.js';
import { resetUpdateState } from '../../src/backend/update/service.js';
import { DEFAULT_UPDATE_PREFERENCES, getUpdatePreferencesPath } from '../../src/backend/update/preferences.js';

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

function releasePayload(tag: string) {
  const installerName = `AEROLAB-Setup-${tag}.exe`;
  return {
    tag_name: tag,
    body: 'Release notes',
    published_at: '2026-10-27T20:00:00Z',
    html_url: `https://github.com/geft/AEROLAB/releases/tag/${tag}`,
    assets: [
      {
        name: installerName,
        size: 2048,
        browser_download_url: `https://github.com/geft/AEROLAB/releases/download/${tag}/${installerName}`
      },
      {
        name: `${installerName}.sha256`,
        size: 80,
        browser_download_url: `https://github.com/geft/AEROLAB/releases/download/${tag}/${installerName}.sha256`
      }
    ]
  };
}

const installerBytes = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2046, 0x41)]);
const installerDigest = createHash('sha256').update(installerBytes).digest('hex');

/** Serve the release payload, installer bytes and checksum from `fetch`. */
function stubReleaseDownloads(checksum: string): void {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('.exe.sha256')) {
      return new Response(`${checksum}  AEROLAB-Setup-v1.5.3.exe\n`, { status: 200 });
    }
    if (url.endsWith('.exe')) {
      return new Response(installerBytes, {
        status: 200,
        headers: { 'content-length': String(installerBytes.byteLength) }
      });
    }
    return new Response(JSON.stringify(releasePayload('v1.5.3')), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }));
}

describe('update routes', () => {
  const previousAppData = process.env.APPDATA;
  const previousAppRoot = process.env.AEROLAB_APP_ROOT;
  const previousProtocol = process.env.AEROLAB_UPDATE_PROTOCOL;
  const previousVersion = process.env.AEROLAB_APP_VERSION;
  let root: string;
  let app: ReturnType<typeof createServer>;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-update-route-'));
    process.env.APPDATA = root;
    process.env.AEROLAB_APP_VERSION = '1.5.2';
    delete process.env.AEROLAB_APP_ROOT;
    delete process.env.AEROLAB_UPDATE_PROTOCOL;
    app = createServer();
  });

  afterAll(() => {
    restoreEnv('APPDATA', previousAppData);
    restoreEnv('AEROLAB_APP_ROOT', previousAppRoot);
    restoreEnv('AEROLAB_UPDATE_PROTOCOL', previousProtocol);
    restoreEnv('AEROLAB_APP_VERSION', previousVersion);
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(() => resetUpdateState());
  afterEach(() => vi.unstubAllGlobals());

  it('reports the running version without touching the network', async () => {
    const response = await request(app).get('/api/system/update').expect(200);
    expect(response.body.currentVersion).toBe('1.5.2');
    expect(response.body.autoCheck).toBe(DEFAULT_UPDATE_PREFERENCES.autoCheck);
    expect(response.body.canInstall).toBe(false);
    expect(response.body.updateAvailable).toBe(false);
    expect(response.body.checkedAt).toBeNull();
  });

  it('offers a newer release from GitHub', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(releasePayload('v1.5.3')), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })));

    const response = await request(app)
      .post('/api/system/update/check')
      .send({ force: true })
      .expect(200);

    expect(response.body.updateAvailable).toBe(true);
    expect(response.body.latestVersion).toBe('1.5.3');
    expect(response.body.release.installerName).toBe('AEROLAB-Setup-v1.5.3.exe');
    expect(response.body.checkedAt).not.toBeNull();
  });

  it('reports an up-to-date build when GitHub answers an older release', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(releasePayload('v1.5.1')), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })));

    const response = await request(app)
      .post('/api/system/update/check')
      .send({ force: true })
      .expect(200);

    expect(response.body.updateAvailable).toBe(false);
  });

  it('maps GitHub rate limiting to a stable error code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));

    const response = await request(app)
      .post('/api/system/update/check')
      .send({ force: true })
      .expect(429);

    expect(response.body.code).toBe('UPDATE_RATE_LIMITED');
  });

  it('persists the startup preference', async () => {
    const saved = await request(app)
      .post('/api/system/update/settings')
      .send({ autoCheck: false })
      .expect(200);
    expect(saved.body.autoCheck).toBe(false);

    const stored = JSON.parse(fs.readFileSync(getUpdatePreferencesPath(), 'utf8')) as { autoCheck: boolean };
    expect(stored.autoCheck).toBe(false);

    const status = await request(app).get('/api/system/update').expect(200);
    expect(status.body.autoCheck).toBe(false);
  });

  it('rejects a non-boolean startup preference', async () => {
    const response = await request(app)
      .post('/api/system/update/settings')
      .send({ autoCheck: 'yes' })
      .expect(400);
    expect(response.body.code).toBe('ERR_INVALID_UPDATE_SETTINGS');
  });

  it('refuses automatic installs without the packaged launcher', async () => {
    const response = await request(app).post('/api/system/update/apply').expect(400);
    expect(response.body.code).toBe('UPDATE_UNSUPPORTED');
  });

  it('downloads, verifies and schedules the installer for the packaged launcher', async () => {
    const updatesDir = path.join(root, 'updates');
    process.env.AEROLAB_APP_ROOT = root;
    process.env.AEROLAB_UPDATE_PROTOCOL = '1';
    process.env.AEROLAB_UPDATE_DIR = updatesDir;
    try {
      stubReleaseDownloads(installerDigest);

      const response = await request(app).post('/api/system/update/apply').expect(202);
      expect(response.body).toEqual({ status: 'scheduled', version: '1.5.3' });

      const pending = JSON.parse(fs.readFileSync(path.join(updatesDir, 'pending-update.json'), 'utf8')) as {
        version: string;
        installerPath: string;
        sha256: string;
      };
      expect(pending.version).toBe('1.5.3');
      expect(pending.sha256).toBe(installerDigest);
      expect(fs.existsSync(pending.installerPath)).toBe(true);
    } finally {
      delete process.env.AEROLAB_APP_ROOT;
      delete process.env.AEROLAB_UPDATE_PROTOCOL;
      delete process.env.AEROLAB_UPDATE_DIR;
    }
  });

  it('rejects an installer that fails its published checksum', async () => {
    const updatesDir = path.join(root, 'updates-bad');
    process.env.AEROLAB_APP_ROOT = root;
    process.env.AEROLAB_UPDATE_PROTOCOL = '1';
    process.env.AEROLAB_UPDATE_DIR = updatesDir;
    try {
      stubReleaseDownloads('0'.repeat(64));

      const response = await request(app).post('/api/system/update/apply').expect(502);
      expect(response.body.code).toBe('UPDATE_CHECKSUM_FAILED');
      expect(fs.existsSync(path.join(updatesDir, 'pending-update.json'))).toBe(false);
    } finally {
      delete process.env.AEROLAB_APP_ROOT;
      delete process.env.AEROLAB_UPDATE_PROTOCOL;
      delete process.env.AEROLAB_UPDATE_DIR;
    }
  });
});
