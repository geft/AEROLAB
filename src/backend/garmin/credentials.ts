import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDatabaseConfigPath } from '../db/path.js';
import {
  GARMIN_API_KEY_ENV,
  GARMIN_API_KEY_EXPIRY_ENV,
  GARMIN_KEY_EXPIRY_WARNING_DAYS,
  type GarminCredentialSource,
  type GarminKeyStatus
} from '../../shared/garmin.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface StoredGarminCredentials {
  /** Null when the record only holds an expiry for an environment key. */
  apiKey: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

export interface ResolvedGarminCredentials {
  apiKey: string;
  source: GarminCredentialSource;
  expiresAt: string | null;
}

/**
 * The key is a password: keep it in a per-user file outside the database so
 * database backups and snapshot exports never contain it.
 */
export function garminCredentialsPath(): string {
  const override = process.env.AEROLAB_GARMIN_CREDENTIALS_PATH?.trim();
  if (override) return path.resolve(override);
  return path.join(path.dirname(getDatabaseConfigPath()), 'garmin-personal-api.json');
}

function parseExpiry(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** Optional expiry supplied alongside an environment key. Invalid values are ignored. */
function readEnvironmentExpiry(): string | null {
  try {
    return normalizeGarminExpiry(process.env[GARMIN_API_KEY_EXPIRY_ENV]);
  } catch {
    return null;
  }
}

function isPast(value: string | null, now: number): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed <= now;
}

function readStoredCredentials(): StoredGarminCredentials | null {
  try {
    const raw = JSON.parse(fs.readFileSync(garminCredentialsPath(), 'utf8')) as Record<string, unknown>;
    const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : null;
    const expiresAt = parseExpiry(raw.expiresAt);
    if (!apiKey && !expiresAt) return null;
    return {
      apiKey,
      expiresAt,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString()
    };
  } catch {
    // A missing or unreadable file simply means no key has been saved yet.
    return null;
  }
}

function writeStoredCredentials(credentials: StoredGarminCredentials): void {
  const target = garminCredentialsPath();
  const temporary = `${target}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function resolveGarminCredentials(): ResolvedGarminCredentials | null {
  const stored = readStoredCredentials();
  if (stored?.apiKey) {
    return { apiKey: stored.apiKey, source: 'stored', expiresAt: stored.expiresAt };
  }
  const environmentKey = process.env[GARMIN_API_KEY_ENV]?.trim();
  if (environmentKey) {
    return {
      apiKey: environmentKey,
      source: 'environment',
      expiresAt: readEnvironmentExpiry() ?? stored?.expiresAt ?? null
    };
  }
  return null;
}

export function saveGarminApiKey(apiKey: string, expiresAt: unknown): void {
  const normalizedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (normalizedKey.length < 8 || normalizedKey.length > 512) {
    throw new Error('Enter a valid Garmin Personal API key.');
  }
  writeStoredCredentials({
    apiKey: normalizedKey,
    expiresAt: normalizeGarminExpiry(expiresAt),
    updatedAt: new Date().toISOString()
  });
}

export function clearStoredGarminCredentials(): void {
  try {
    fs.unlinkSync(garminCredentialsPath());
  } catch {
    // Nothing saved, or already removed.
  }
}

/** Record an expiry date for a key supplied through the environment. */
export function saveGarminKeyExpiry(expiresAt: unknown): void {
  // An expiry in `.env.local` is authoritative and never mirrored to disk.
  if (readEnvironmentExpiry()) return;
  const normalized = normalizeGarminExpiry(expiresAt);
  if (!normalized) {
    clearStoredGarminCredentials();
    return;
  }
  if (!process.env[GARMIN_API_KEY_ENV]?.trim()) {
    throw new Error('No Garmin environment key is configured.');
  }
  writeStoredCredentials({
    apiKey: null,
    expiresAt: normalized,
    updatedAt: new Date().toISOString()
  });
}

/** Accepts `YYYY-MM-DD` (end of that local day) or a full ISO timestamp. */
export function normalizeGarminExpiry(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error('Invalid Garmin key expiry date.');
  const trimmed = value.trim();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T23:59:59`).getTime()
    : Date.parse(trimmed);
  if (!Number.isFinite(parsed)) throw new Error('Invalid Garmin key expiry date.');
  return new Date(parsed).toISOString();
}

/**
 * The Personal API token endpoint only reveals a key's expiry when the key
 * expires before the 24-hour token does. Record that earlier date so the
 * warning appears without asking the user to re-enter it.
 */
export function recordDetectedGarminKeyExpiry(expiresAt: string): void {
  const stored = readStoredCredentials();
  const environmentKey = process.env[GARMIN_API_KEY_ENV]?.trim();
  // A configured environment expiry is authoritative; never mirror it to disk.
  if (environmentKey && readEnvironmentExpiry()) return;
  const detected = Date.parse(expiresAt);
  if ((!stored && !environmentKey) || !Number.isFinite(detected)) return;
  const current = stored?.expiresAt ? Date.parse(stored.expiresAt) : Number.POSITIVE_INFINITY;
  if (detected >= current) return;
  writeStoredCredentials({
    apiKey: stored?.apiKey ?? null,
    expiresAt: new Date(detected).toISOString(),
    updatedAt: new Date().toISOString()
  });
}

export function getGarminKeyStatus(now = Date.now()): GarminKeyStatus {
  const stored = readStoredCredentials();
  const environmentKey = process.env[GARMIN_API_KEY_ENV]?.trim();
  const environmentExpiry = environmentKey ? readEnvironmentExpiry() : null;
  let expired = false;

  if (stored?.apiKey) {
    if (isPast(stored.expiresAt, now)) {
      // An expired key is useless and must not be offered to the sync flow.
      clearStoredGarminCredentials();
      expired = true;
    }
  } else if (environmentKey) {
    if (environmentExpiry) {
      // The environment cannot be rewritten, so only report the expiry.
      if (isPast(environmentExpiry, now)) expired = true;
    } else if (isPast(stored?.expiresAt ?? null, now)) {
      clearStoredGarminCredentials();
      expired = true;
    }
  } else if (isPast(stored?.expiresAt ?? null, now)) {
    clearStoredGarminCredentials();
    expired = true;
  }

  const resolved = resolveGarminCredentials();
  if (!resolved) {
    return {
      configured: false,
      source: null,
      expiresAt: null,
      daysUntilExpiry: null,
      expiringSoon: false,
      expired,
      expirySource: null
    };
  }

  const expiry = resolved.expiresAt ? Date.parse(resolved.expiresAt) : Number.NaN;
  const hasExpiry = Number.isFinite(expiry);
  const daysUntilExpiry = hasExpiry ? Math.ceil((expiry - now) / DAY_MS) : null;
  const expirySource = hasExpiry
    ? resolved.source === 'environment' && environmentExpiry
      ? 'environment'
      : 'stored'
    : null;
  return {
    configured: true,
    source: resolved.source,
    expiresAt: hasExpiry ? new Date(expiry).toISOString() : null,
    daysUntilExpiry,
    expiringSoon: hasExpiry && expiry - now <= GARMIN_KEY_EXPIRY_WARNING_DAYS * DAY_MS,
    expired,
    expirySource
  };
}
