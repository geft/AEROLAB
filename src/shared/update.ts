/**
 * Contract for the desktop updater.
 *
 * AEROLAB ships as a Windows installer published on GitHub Releases. The backend
 * checks `releases/latest`, the frontend shows the result, and the packaged
 * launcher applies the downloaded installer. These types are shared so the two
 * sides cannot drift.
 */

export const AEROLAB_GITHUB_REPO = 'geft/AEROLAB';

export const AEROLAB_RELEASES_URL = `https://github.com/${AEROLAB_GITHUB_REPO}/releases`;

export const AEROLAB_LATEST_RELEASE_API_URL = `https://api.github.com/repos/${AEROLAB_GITHUB_REPO}/releases/latest`;

/** Release asset naming produced by scripts/package-chromium-free.js. */
export const INSTALLER_ASSET_PATTERN = /^AEROLAB-Setup-v[\w.-]+\.exe$/i;

/** How long a GitHub check is reused before another network call is made. */
export const UPDATE_CHECK_TTL_MS = 5 * 60 * 1000;

export interface UpdatePreferences {
  /** Check on startup and install a newer release automatically. */
  autoCheck: boolean;
}

export interface ReleaseAsset {
  name: string;
  size?: number | null;
  browser_download_url?: string | null;
}

export interface UpdateRelease {
  version: string;
  tag: string;
  publishedAt: string | null;
  notes: string | null;
  pageUrl: string;
  installerName: string | null;
  installerUrl: string | null;
  installerSize: number | null;
  checksumUrl: string | null;
}

export interface UpdateStatus {
  currentVersion: string;
  currentCommit: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  release: UpdateRelease | null;
  autoCheck: boolean;
  /** True when the packaged launcher can apply a downloaded installer. */
  canInstall: boolean;
  checkedAt: string | null;
}

export interface UpdateSettingsResponse {
  autoCheck: boolean;
}

export interface UpdateApplyResponse {
  status: 'scheduled';
  version: string;
}

export type UpdateErrorCode =
  | 'UPDATE_CHECK_FAILED'
  | 'UPDATE_RATE_LIMITED'
  | 'UPDATE_DOWNLOAD_FAILED'
  | 'UPDATE_CHECKSUM_FAILED'
  | 'UPDATE_NOT_AVAILABLE'
  | 'UPDATE_UNSUPPORTED'
  | 'UPDATE_BUSY'
  | 'ERR_INVALID_UPDATE_SETTINGS';

/** Trim a leading `v` so tags and package versions compare directly. */
export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string | null;
}

function parseVersion(value: string): ParsedVersion {
  const normalized = normalizeVersion(value);
  const [corePart, ...rest] = normalized.split('-');
  const numbers = corePart.split('.').map(part => {
    const digits = part.replace(/[^0-9].*$/, '');
    const numeric = Number.parseInt(digits, 10);
    return Number.isFinite(numeric) ? numeric : 0;
  });
  return {
    core: [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0],
    prerelease: rest.length > 0 ? rest.join('-').toLowerCase() : null
  };
}

/** Semantic version ordering: negative, zero or positive. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  // A release outranks its own prereleases.
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export interface SelectedInstaller {
  name: string;
  url: string;
  size: number | null;
  checksumUrl: string | null;
}

/**
 * Pick the installer published for `version`, preferring an exact name match so
 * a release that also carries older artifacts cannot update to the wrong build.
 */
export function selectInstaller(assets: ReleaseAsset[], version: string): SelectedInstaller | null {
  const usable = assets.filter(asset =>
    typeof asset.browser_download_url === 'string' &&
    asset.browser_download_url.length > 0 &&
    INSTALLER_ASSET_PATTERN.test(asset.name)
  );
  if (usable.length === 0) return null;

  const expected = `AEROLAB-Setup-v${normalizeVersion(version)}.exe`.toLowerCase();
  const chosen = usable.find(asset => asset.name.toLowerCase() === expected) ?? usable[0];
  const checksum = assets.find(asset =>
    asset.name.toLowerCase() === `${chosen.name}.sha256`.toLowerCase() &&
    typeof asset.browser_download_url === 'string' &&
    asset.browser_download_url.length > 0
  );

  return {
    name: chosen.name,
    url: chosen.browser_download_url as string,
    size: typeof chosen.size === 'number' ? chosen.size : null,
    checksumUrl: checksum?.browser_download_url ?? null
  };
}

/** Read the hex digest out of a `sha256sum` style file. */
export function parseChecksumFile(text: string): string | null {
  const match = /^([a-f0-9]{64})(?:\s|$)/im.exec(text.trim());
  return match ? match[1].toLowerCase() : null;
}
