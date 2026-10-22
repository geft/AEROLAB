import { createHash } from 'node:crypto';

const DEFAULT_BASE_URL = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_EXPIRY_SECONDS = 24 * 60 * 60;

export type GarminApiErrorCode =
  | 'GARMIN_KEY_MISSING'
  | 'GARMIN_KEY_INVALID'
  | 'GARMIN_RATE_LIMITED'
  | 'GARMIN_UNAVAILABLE'
  | 'GARMIN_DOWNLOAD_FAILED';

export class GarminApiError extends Error {
  constructor(
    public readonly code: GarminApiErrorCode,
    message: string,
    public readonly status = 502
  ) {
    super(message);
    this.name = 'GarminApiError';
  }
}

export interface GarminActivitySummary {
  activityId: string;
  activityName?: string;
  /** Local wall-clock start, `YYYY-MM-DD HH:MM:SS` when Garmin provides it. */
  startTimeLocal: string | null;
  startTimeGmt: string | null;
  activityTypeKey: string | null;
  distanceMeters: number | null;
}

export interface GarminAccessToken {
  accessToken: string;
  expiresAt: number;
  issuedAt: number | null;
}

/** Garmin tokens normally live 24 hours; a shorter lifetime means the key itself expires sooner. */
const KEY_EXPIRY_LIFETIME_MS = 23 * 60 * 60 * 1000;

/** Returns the inferred key expiry when the token's own lifetime is truncated. */
export function garminKeyExpiryFromToken(token: GarminAccessToken): string | null {
  if (!token.issuedAt || token.expiresAt - token.issuedAt >= KEY_EXPIRY_LIFETIME_MS) return null;
  return new Date(token.expiresAt).toISOString();
}

let cachedToken: { fingerprint: string; token: GarminAccessToken } | null = null;

function baseUrl(): string {
  return (process.env.GARMIN_PERSONAL_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function fingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/** Decode `exp` and `iat` without verifying the signature (the server mints it). */
export function decodeGarminTokenClaims(token: string): { expiresAt: number | null; issuedAt: number | null } {
  const numeric = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value * 1000 : null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return { expiresAt: null, issuedAt: null };
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown; iat?: unknown };
    return { expiresAt: numeric(claims.exp), issuedAt: numeric(claims.iat) };
  } catch {
    return { expiresAt: null, issuedAt: null };
  }
}

/** Decode the `exp` claim without verifying the signature (the server mints it). */
export function decodeGarminTokenExpiry(token: string): number | null {
  return decodeGarminTokenClaims(token).expiresAt;
}

function upstreamError(status: number, action: string): GarminApiError {
  if (status === 401 || status === 403) {
    return new GarminApiError(
      'GARMIN_KEY_INVALID',
      'Garmin rejected the Personal API key. The key may have expired or been deleted.',
      401
    );
  }
  if (status === 429) {
    return new GarminApiError('GARMIN_RATE_LIMITED', 'Garmin is rate limiting requests. Try again in a few minutes.', 429);
  }
  return new GarminApiError('GARMIN_UNAVAILABLE', `Garmin Connect could not complete the ${action} request.`, 502);
}

async function garminFetch(url: string, init: RequestInit, action: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new GarminApiError('GARMIN_UNAVAILABLE', 'Garmin Connect is unreachable. Check the internet connection and try again.', 502);
  }
  if (!response.ok) throw upstreamError(response.status, action);
  return response;
}

export async function obtainGarminAccessToken(apiKey: string): Promise<GarminAccessToken> {
  const key = apiKey.trim();
  if (!key) {
    throw new GarminApiError('GARMIN_KEY_MISSING', 'Add a Garmin Personal API key in Settings first.', 400);
  }

  const keyFingerprint = fingerprint(key);
  if (cachedToken && cachedToken.fingerprint === keyFingerprint && cachedToken.token.expiresAt - Date.now() > 5 * 60 * 1000) {
    return cachedToken.token;
  }

  const response = await garminFetch(`${baseUrl()}${TOKEN_PATH}`, {
    method: 'POST',
    headers: { Accept: '*/*', Authorization: `ApiKey ${key}` }
  }, 'token');
  const accessToken = (await response.text()).trim();
  if (!accessToken) {
    throw new GarminApiError('GARMIN_UNAVAILABLE', 'Garmin Connect returned an empty access token.', 502);
  }
  const token: GarminAccessToken = {
    accessToken,
    expiresAt: decodeGarminTokenExpiry(accessToken) ?? Date.now() + TOKEN_EXPIRY_SECONDS * 1000,
    issuedAt: decodeGarminTokenClaims(accessToken).issuedAt
  };
  cachedToken = { fingerprint: keyFingerprint, token };
  return token;
}

/** Test seam: forget a cached bearer token. */
export function resetGarminTokenCache(): void {
  cachedToken = null;
}

export function normalizeGarminStartTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/i, '');
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized) ? normalized : null;
}

export function isRunningGarminActivity(activity: GarminActivitySummary): boolean {
  return /run/i.test(activity.activityTypeKey ?? '');
}

interface GarminSearchResponse {
  activityList?: unknown;
}

function mapActivity(raw: unknown): GarminActivitySummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = record.activityId ?? record.activityid;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const type = record.activityType;
  const activityTypeKey = typeof type === 'string'
    ? type
    : type && typeof type === 'object' && typeof (type as Record<string, unknown>).typeKey === 'string'
      ? (type as Record<string, unknown>).typeKey as string
      : null;
  const distance = record.distance;
  return {
    activityId: String(id),
    activityName: typeof record.activityName === 'string' ? record.activityName : undefined,
    startTimeLocal: normalizeGarminStartTime(typeof record.startTimeLocal === 'string' ? record.startTimeLocal : null),
    startTimeGmt: normalizeGarminStartTime(typeof record.startTimeGMT === 'string' ? record.startTimeGMT : null),
    activityTypeKey,
    distanceMeters: typeof distance === 'number' && Number.isFinite(distance) ? distance : null
  };
}

export async function searchGarminActivities(
  token: GarminAccessToken,
  options: { startDate?: string; endDate?: string; limit: number }
): Promise<GarminActivitySummary[]> {
  const query = new URLSearchParams({
    start: '0',
    limit: String(options.limit),
    activityType: 'running'
  });
  if (options.startDate) query.set('startDate', options.startDate);
  if (options.endDate) query.set('endDate', options.endDate);

  const response = await garminFetch(
    `${baseUrl()}/activitylist-service/activities/search/activities?${query.toString()}`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token.accessToken}` } },
    'activity search'
  );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GarminApiError('GARMIN_UNAVAILABLE', 'Garmin Connect returned an unreadable activity list.', 502);
  }
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as GarminSearchResponse)?.activityList)
      ? (payload as GarminSearchResponse).activityList as unknown[]
      : [];
  return rows.map(mapActivity).filter((activity): activity is GarminActivitySummary => activity !== null);
}

/** Downloads the original activity file: a ZIP archive containing one FIT file. */
export async function downloadGarminActivity(token: GarminAccessToken, activityId: string): Promise<Buffer> {
  const response = await garminFetch(
    `${baseUrl()}/download-service/files/activity/${encodeURIComponent(activityId)}`,
    { headers: { Accept: 'application/zip, application/x-zip-compressed, application/octet-stream', Authorization: `Bearer ${token.accessToken}` } },
    'activity download'
  );
  const content = Buffer.from(await response.arrayBuffer());
  if (!content.length) {
    throw new GarminApiError('GARMIN_DOWNLOAD_FAILED', 'Garmin Connect returned an empty activity file.', 502);
  }
  return content;
}
