import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
  INSTALLER_ASSET_PATTERN,
  UPDATE_CHECK_TTL_MS,
  isNewerVersion,
  parseChecksumFile,
  type UpdatePreferences,
  type UpdateRelease,
  type UpdateStatus
} from '../../shared/update.js';
import { currentBuildInfo, isUpdateInstallSupported, type CurrentBuildInfo } from './build.js';
import { UpdateServiceError } from './errors.js';
import { getPendingUpdatePath, getUpdateStagingDir, readUpdatePreferences } from './preferences.js';
import { fetchLatestRelease } from './release.js';

const DOWNLOAD_TIMEOUT_MS = 180_000;
const CHECKSUM_TIMEOUT_MS = 20_000;
const MAX_INSTALLER_BYTES = 300 * 1024 * 1024;

interface CachedCheck {
  release: UpdateRelease | null;
  checkedAt: string;
}

let cachedCheck: CachedCheck | null = null;
let installInFlight = false;

/** Test hook: forget cached GitHub answers and in-flight state. */
export function resetUpdateState(): void {
  cachedCheck = null;
  installInFlight = false;
}

function buildStatus(build: CurrentBuildInfo, cached: CachedCheck | null, preferences: UpdatePreferences): UpdateStatus {
  const latestVersion = cached?.release?.version ?? null;
  return {
    currentVersion: build.version,
    currentCommit: build.commit,
    latestVersion,
    updateAvailable: latestVersion !== null ? isNewerVersion(latestVersion, build.version) : false,
    release: cached?.release ?? null,
    autoCheck: preferences.autoCheck,
    canInstall: isUpdateInstallSupported(),
    checkedAt: cached?.checkedAt ?? null
  };
}

/** Last known state without touching the network. */
export function getUpdateStatus(): UpdateStatus {
  return buildStatus(currentBuildInfo(), cachedCheck, readUpdatePreferences());
}

function checkIsFresh(cached: CachedCheck | null): boolean {
  if (!cached) return false;
  const checkedAt = Date.parse(cached.checkedAt);
  return Number.isFinite(checkedAt) && Date.now() - checkedAt < UPDATE_CHECK_TTL_MS;
}

/** Query GitHub Releases, reusing a recent answer unless `force` is set. */
export async function checkForUpdate(options: { force?: boolean } = {}): Promise<UpdateStatus> {
  if (options.force || !checkIsFresh(cachedCheck)) {
    const release = await fetchLatestRelease();
    cachedCheck = { release, checkedAt: new Date().toISOString() };
  }
  return buildStatus(currentBuildInfo(), cachedCheck, readUpdatePreferences());
}

async function downloadInstaller(url: string): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'AEROLAB-Desktop' },
      redirect: 'follow',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UpdateServiceError('UPDATE_DOWNLOAD_FAILED', `Could not download the installer: ${reason}`);
  }
  if (!response.ok) {
    throw new UpdateServiceError('UPDATE_DOWNLOAD_FAILED', `The installer download answered HTTP ${response.status}.`);
  }

  const declaredLength = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_INSTALLER_BYTES) {
    throw new UpdateServiceError('UPDATE_DOWNLOAD_FAILED', 'The installer is larger than AEROLAB expects.');
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UpdateServiceError('UPDATE_DOWNLOAD_FAILED', `The installer download was interrupted: ${reason}`);
  }
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_INSTALLER_BYTES) {
    throw new UpdateServiceError('UPDATE_DOWNLOAD_FAILED', 'The installer download was empty or oversized.');
  }
  // Every Windows executable starts with "MZ"; anything else is a broken download.
  if (buffer[0] !== 0x4d || buffer[1] !== 0x5a) {
    throw new UpdateServiceError('UPDATE_DOWNLOAD_FAILED', 'The downloaded file is not a Windows installer.');
  }
  return buffer;
}

async function fetchChecksum(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'AEROLAB-Desktop' },
      redirect: 'follow',
      signal: AbortSignal.timeout(CHECKSUM_TIMEOUT_MS)
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UpdateServiceError('UPDATE_CHECKSUM_FAILED', `Could not download the installer checksum: ${reason}`);
  }
  if (!response.ok) {
    throw new UpdateServiceError('UPDATE_CHECKSUM_FAILED', `The checksum download answered HTTP ${response.status}.`);
  }
  const checksum = parseChecksumFile(await response.text());
  if (!checksum) {
    throw new UpdateServiceError('UPDATE_CHECKSUM_FAILED', 'The published checksum could not be read.');
  }
  return checksum;
}

function removeStaleInstallers(keepName: string): void {
  const stagingDir = getUpdateStagingDir();
  try {
    for (const entry of fs.readdirSync(stagingDir)) {
      if (entry === keepName || entry === `${keepName}.part` || entry === 'pending-update.json') continue;
      if (/^AEROLAB-Setup-v[\w.-]+\.exe(\.part)?$/i.test(entry)) {
        fs.rmSync(path.join(stagingDir, entry), { force: true });
      }
    }
  } catch { /* intentionally ignored: cleanup is best effort */ }
}

export interface ScheduledUpdate {
  version: string;
  installerPath: string;
}

/**
 * Download and verify the newest installer, then drop the marker file the
 * packaged launcher polls. The launcher closes the window, runs the installer in
 * silent mode and the installer relaunches AEROLAB.
 */
export async function scheduleUpdateInstall(): Promise<ScheduledUpdate> {
  if (!isUpdateInstallSupported()) {
    throw new UpdateServiceError('UPDATE_UNSUPPORTED', 'Automatic updates are only available in the installed desktop app.', 400);
  }
  if (installInFlight) {
    throw new UpdateServiceError('UPDATE_BUSY', 'An update is already being prepared.', 409);
  }

  installInFlight = true;
  try {
    const status = await checkForUpdate();
    const release = status.release;
    if (!status.updateAvailable || !release) {
      throw new UpdateServiceError('UPDATE_NOT_AVAILABLE', 'AEROLAB is already up to date.', 409);
    }
    if (!release.installerName || !release.installerUrl) {
      throw new UpdateServiceError('UPDATE_DOWNLOAD_FAILED', 'The latest release has no Windows installer.');
    }
    if (!INSTALLER_ASSET_PATTERN.test(release.installerName)) {
      throw new UpdateServiceError('UPDATE_DOWNLOAD_FAILED', 'The latest release installer has an unexpected name.');
    }

    const bytes = await downloadInstaller(release.installerUrl);
    if (release.installerSize !== null && bytes.byteLength !== release.installerSize) {
      throw new UpdateServiceError('UPDATE_DOWNLOAD_FAILED', 'The installer download was incomplete.');
    }
    if (release.checksumUrl) {
      const expected = await fetchChecksum(release.checksumUrl);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expected) {
        throw new UpdateServiceError('UPDATE_CHECKSUM_FAILED', 'The installer checksum did not match the published digest.');
      }
    }

    const stagingDir = getUpdateStagingDir();
    fs.mkdirSync(stagingDir, { recursive: true });
    removeStaleInstallers(release.installerName);
    const installerPath = path.join(stagingDir, release.installerName);
    const temporaryPath = `${installerPath}.part`;
    fs.writeFileSync(temporaryPath, bytes);
    fs.renameSync(temporaryPath, installerPath);

    const pendingPath = getPendingUpdatePath();
    const pendingTemporaryPath = `${pendingPath}.tmp`;
    fs.writeFileSync(pendingTemporaryPath, `${JSON.stringify({
      version: release.version,
      installerPath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      requestedAt: new Date().toISOString()
    }, null, 2)}\n`, { encoding: 'utf8' });
    fs.renameSync(pendingTemporaryPath, pendingPath);

    return { version: release.version, installerPath };
  } finally {
    installInFlight = false;
  }
}
