import {
  AEROLAB_LATEST_RELEASE_API_URL,
  AEROLAB_RELEASES_URL,
  normalizeVersion,
  selectInstaller,
  type ReleaseAsset,
  type UpdateRelease
} from '../../shared/update.js';
import { UpdateServiceError } from './errors.js';

const REQUEST_TIMEOUT_MS = 15_000;

interface GitHubReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

function toAsset(value: unknown): ReleaseAsset | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string') return null;
  return {
    name: record.name,
    size: typeof record.size === 'number' ? record.size : null,
    browser_download_url: typeof record.browser_download_url === 'string' ? record.browser_download_url : null
  };
}

/** Map the GitHub JSON payload onto the shared release contract. */
export function parseLatestRelease(payload: unknown): UpdateRelease {
  if (!payload || typeof payload !== 'object') {
    throw new UpdateServiceError('UPDATE_CHECK_FAILED', 'Unexpected GitHub release payload.');
  }
  const record = payload as GitHubReleasePayload;
  const tag = typeof record.tag_name === 'string' ? record.tag_name.trim() : '';
  const version = normalizeVersion(tag || (typeof record.name === 'string' ? record.name : ''));
  if (!version) {
    throw new UpdateServiceError('UPDATE_CHECK_FAILED', 'The latest release has no version tag.');
  }

  const assets = (Array.isArray(record.assets) ? record.assets : [])
    .map(toAsset)
    .filter((asset): asset is ReleaseAsset => asset !== null);
  const installer = selectInstaller(assets, version);
  const resolvedTag = tag || `v${version}`;

  return {
    version,
    tag: resolvedTag,
    publishedAt: typeof record.published_at === 'string' ? record.published_at : null,
    notes: typeof record.body === 'string' && record.body.trim() ? record.body.trim().slice(0, 4000) : null,
    pageUrl: typeof record.html_url === 'string' && record.html_url.startsWith('https://github.com/')
      ? record.html_url
      : `${AEROLAB_RELEASES_URL}/tag/${encodeURIComponent(resolvedTag)}`,
    installerName: installer?.name ?? null,
    installerUrl: installer?.url ?? null,
    installerSize: installer?.size ?? null,
    checksumUrl: installer?.checksumUrl ?? null
  };
}

/**
 * Read the newest published release. A repository with no releases yet answers
 * 404, which is a normal "nothing to install" state rather than a failure.
 */
export async function fetchLatestRelease(): Promise<UpdateRelease | null> {
  let response: Response;
  try {
    response = await fetch(AEROLAB_LATEST_RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'AEROLAB-Desktop',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new UpdateServiceError('UPDATE_CHECK_FAILED', `Could not reach GitHub Releases: ${reason}`);
  }

  if (response.status === 404) return null;
  if (response.status === 403 || response.status === 429) {
    throw new UpdateServiceError('UPDATE_RATE_LIMITED', 'GitHub is rate limiting update checks. Try again later.', 429);
  }
  if (!response.ok) {
    throw new UpdateServiceError('UPDATE_CHECK_FAILED', `GitHub Releases answered HTTP ${response.status}.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new UpdateServiceError('UPDATE_CHECK_FAILED', 'GitHub Releases returned an unreadable response.');
  }
  return parseLatestRelease(payload);
}
