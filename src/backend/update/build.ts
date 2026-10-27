import fs from 'fs';
import path from 'path';
import { normalizeVersion } from '../../shared/update.js';

export interface CurrentBuildInfo {
  version: string;
  commit: string;
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function versionFileCandidates(): string[] {
  const candidates: string[] = [];
  const appRoot = process.env.AEROLAB_APP_ROOT?.trim();
  if (appRoot) candidates.push(path.join(appRoot, 'dist-backend', 'version.json'));
  // The bundled server lives beside its own version.json (dist-backend/server.cjs).
  // A development run is ESM, where `__dirname` is undefined, so a stale local
  // build manifest can never masquerade as the running version.
  if (typeof __dirname !== 'undefined') candidates.push(path.join(__dirname, 'version.json'));
  return candidates;
}

/**
 * Version reported by the running build. The packaged app reads the manifest the
 * packaging step wrote next to `server.cjs`; a development checkout falls back to
 * package.json. `AEROLAB_APP_VERSION` exists for tests.
 */
export function currentBuildInfo(): CurrentBuildInfo {
  const override = process.env.AEROLAB_APP_VERSION?.trim();
  if (override) return { version: normalizeVersion(override), commit: '' };

  for (const candidate of versionFileCandidates()) {
    const manifest = readJson(candidate);
    if (manifest && typeof manifest.version === 'string' && manifest.version.trim()) {
      return {
        version: normalizeVersion(manifest.version),
        commit: typeof manifest.gitCommit === 'string' ? manifest.gitCommit : ''
      };
    }
  }

  const pkg = readJson(path.join(process.cwd(), 'package.json'));
  return {
    version: pkg && typeof pkg.version === 'string' ? normalizeVersion(pkg.version) : '0.0.0',
    commit: ''
  };
}

/**
 * Applying an update means the packaged launcher takes over: it closes the app
 * window, runs the downloaded installer silently and lets the installer relaunch
 * AEROLAB. Development servers have no launcher watching for the marker file.
 */
export function isUpdateInstallSupported(): boolean {
  if (process.platform !== 'win32') return false;
  return Boolean(process.env.AEROLAB_UPDATE_PROTOCOL?.trim()) && Boolean(process.env.AEROLAB_APP_ROOT?.trim());
}
