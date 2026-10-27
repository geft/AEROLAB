import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  compareVersions,
  isNewerVersion,
  normalizeVersion,
  parseChecksumFile,
  selectInstaller
} from '../../src/shared/update.js';
import { parseLatestRelease } from '../../src/backend/update/release.js';
import { UpdateServiceError } from '../../src/backend/update/errors.js';
import {
  DEFAULT_UPDATE_PREFERENCES,
  getUpdatePreferencesPath,
  readUpdatePreferences,
  saveUpdatePreferences
} from '../../src/backend/update/preferences.js';

describe('version ordering', () => {
  it('compares numeric segments instead of strings', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.5.2', 'v1.5.2')).toBe(0);
    expect(compareVersions('1.4.9', '1.5.0')).toBe(-1);
  });

  it('treats a prerelease as older than its final release', () => {
    expect(isNewerVersion('1.6.0', '1.6.0-beta.1')).toBe(true);
    expect(isNewerVersion('1.6.0-beta.2', '1.6.0-beta.1')).toBe(true);
    expect(isNewerVersion('1.6.0-beta.1', '1.6.0')).toBe(false);
  });

  it('normalizes tag prefixes', () => {
    expect(normalizeVersion(' v1.5.3 ')).toBe('1.5.3');
  });
});

describe('installer asset selection', () => {
  const assets = [
    { name: 'AEROLAB-Setup-v1.5.2.exe', size: 10, browser_download_url: 'https://github.com/geft/AEROLAB/old.exe' },
    { name: 'AEROLAB-Setup-v1.5.3.exe', size: 20, browser_download_url: 'https://github.com/geft/AEROLAB/new.exe' },
    { name: 'AEROLAB-Setup-v1.5.3.exe.sha256', size: 1, browser_download_url: 'https://github.com/geft/AEROLAB/new.exe.sha256' },
    { name: 'source.zip', size: 2, browser_download_url: 'https://github.com/geft/AEROLAB/source.zip' }
  ];

  it('prefers the installer named for the requested version', () => {
    expect(selectInstaller(assets, '1.5.3')).toEqual({
      name: 'AEROLAB-Setup-v1.5.3.exe',
      url: 'https://github.com/geft/AEROLAB/new.exe',
      size: 20,
      checksumUrl: 'https://github.com/geft/AEROLAB/new.exe.sha256'
    });
  });

  it('reports no installer when the release only ships sources', () => {
    expect(selectInstaller([assets[3]], '1.5.3')).toBeNull();
  });
});

describe('release payload parsing', () => {
  const payload = {
    tag_name: 'v1.5.3',
    body: 'Fixes the Garmin sync failure.',
    published_at: '2026-10-27T20:00:00Z',
    html_url: 'https://github.com/geft/AEROLAB/releases/tag/v1.5.3',
    assets: [
      {
        name: 'AEROLAB-Setup-v1.5.3.exe',
        size: 100,
        browser_download_url: 'https://github.com/geft/AEROLAB/releases/download/v1.5.3/AEROLAB-Setup-v1.5.3.exe'
      }
    ]
  };

  it('maps the GitHub payload onto the shared contract', () => {
    const release = parseLatestRelease(payload);
    expect(release.version).toBe('1.5.3');
    expect(release.tag).toBe('v1.5.3');
    expect(release.installerName).toBe('AEROLAB-Setup-v1.5.3.exe');
    expect(release.checksumUrl).toBeNull();
    expect(release.pageUrl).toBe('https://github.com/geft/AEROLAB/releases/tag/v1.5.3');
  });

  it('rejects a release without a version tag', () => {
    expect(() => parseLatestRelease({ tag_name: '' })).toThrow(UpdateServiceError);
    try {
      parseLatestRelease({ tag_name: '' });
    } catch (error) {
      expect((error as UpdateServiceError).code).toBe('UPDATE_CHECK_FAILED');
    }
  });
});

describe('checksum files', () => {
  it('reads a sha256sum line', () => {
    const digest = 'a'.repeat(64);
    expect(parseChecksumFile(`${digest}  AEROLAB-Setup-v1.5.3.exe\n`)).toBe(digest);
  });

  it('rejects content that is not a digest', () => {
    expect(parseChecksumFile('not a checksum')).toBeNull();
  });
});

describe('update preferences', () => {
  const previousAppData = process.env.APPDATA;
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-update-prefs-'));
    process.env.APPDATA = root;
  });

  afterEach(() => {
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('defaults to checking on startup', () => {
    expect(readUpdatePreferences()).toEqual(DEFAULT_UPDATE_PREFERENCES);
    expect(DEFAULT_UPDATE_PREFERENCES.autoCheck).toBe(true);
  });

  it('persists the toggle outside the database', () => {
    saveUpdatePreferences({ autoCheck: false });
    expect(readUpdatePreferences()).toEqual({ autoCheck: false });
    const stored = JSON.parse(fs.readFileSync(getUpdatePreferencesPath(), 'utf8')) as { autoCheck: boolean };
    expect(stored.autoCheck).toBe(false);
    expect(getUpdatePreferencesPath().startsWith(root)).toBe(true);
  });

  it('falls back to defaults for a malformed file', () => {
    fs.mkdirSync(path.dirname(getUpdatePreferencesPath()), { recursive: true });
    fs.writeFileSync(getUpdatePreferencesPath(), '{not json');
    expect(readUpdatePreferences()).toEqual(DEFAULT_UPDATE_PREFERENCES);
  });
});
