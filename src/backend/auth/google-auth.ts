import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'crypto';

/**
 * PKCE helpers (RFC 7636).
 *
 * The OAuth loopback redirect (http://localhost:PORT/...) can be observed by any
 * process on the machine, so an authorization code could in principle be
 * intercepted and exchanged by another local program. PKCE binds the code to a
 * one-time `code_verifier` that never leaves this process: the server only
 * accepts the exchange when the verifier hashes to the `code_challenge` that was
 * sent with the original request.
 */

/** A high-entropy code verifier (base64url of 32 random bytes, 43 chars). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** S256 challenge = BASE64URL(SHA256(ASCII(code_verifier))). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export interface GoogleCredentials {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

export interface GoogleAuthStatus {
  isConfigured: boolean; // Has Client ID configured
  isConnected: boolean;  // Has active access/refresh token
  email: string | null;
  name: string | null;
  picture: string | null;
  expiresAt: string | null;
}

export function ensureGoogleAuthTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_auth (
      id TEXT PRIMARY KEY,
      client_id TEXT,
      client_secret TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expiry_date INTEGER,
      email TEXT,
      name TEXT,
      picture TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Built-in OAuth client identifier.
 *
 * Google Drive sync is a first-class feature, so AEROLAB ships a public client
 * ID and users never have to create or paste credentials. A client *ID* is a
 * public identifier (it appears in the consent URL on every sign-in) and is
 * safe to embed; the matching client **secret is deliberately NOT bundled** —
 * `clientSecret` stays optional and is only ever read from the environment or
 * an explicitly configured value.
 *
 * Power users may override either value with:
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *
 * Follow-up hardening (OAuth 2.1 / RFC 8252): migrate to a "Desktop app" client
 * using PKCE (`code_challenge` / `code_verifier`) so no secret is required at
 * all and the loopback redirect is fully scoped to this device.
 */
export const DEFAULT_GOOGLE_CLIENT_ID = '805691757155-m96h9kbbb1v1pno1qa3bfq5bn1t5k91i.apps.googleusercontent.com';

export function getGoogleConfig(db: Database.Database): { clientId: string | null; clientSecret: string | null } {
  ensureGoogleAuthTable(db);
  const row = db.prepare("SELECT client_id, client_secret FROM google_auth WHERE id = 'primary'").get() as any;
  const clientId = row?.client_id || process.env.GOOGLE_CLIENT_ID || (process.env.NODE_ENV === 'test' ? null : DEFAULT_GOOGLE_CLIENT_ID);
  const clientSecret = row?.client_secret || process.env.GOOGLE_CLIENT_SECRET || null;
  return { clientId, clientSecret };
}

export function saveGoogleCredentials(db: Database.Database, clientId: string, clientSecret: string = ''): void {
  ensureGoogleAuthTable(db);
  const secret = (clientSecret || '').trim();
  const existing = db.prepare("SELECT id FROM google_auth WHERE id = 'primary'").get();
  if (existing) {
    db.prepare(`
      UPDATE google_auth
      SET client_id = ?, client_secret = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 'primary'
    `).run(clientId.trim(), secret);
  } else {
    db.prepare(`
      INSERT INTO google_auth (id, client_id, client_secret)
      VALUES ('primary', ?, ?)
    `).run(clientId.trim(), secret);
  }
}

export function getRedirectUri(customOrigin?: string): string {
  // If customOrigin provided, use it (e.g., http://localhost:3001)
  const base = customOrigin || process.env.SERVER_URL || 'http://localhost:3001';
  return `${base.replace(/\/$/, '')}/api/auth/google/callback`;
}

export function getGoogleAuthUrl(
  db: Database.Database,
  origin?: string,
  state?: string,
  codeChallenge?: string
): { url: string; error?: string } {
  const { clientId } = getGoogleConfig(db);
  if (!clientId) {
    return { url: '', error: 'Google Client ID is not configured. Please enter your Google OAuth Client ID first.' };
  }

  const redirectUri = getRedirectUri(origin);
  const scopes = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/drive.file'
  ].join(' ');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    state: state || 'aerolab_auth'
  });

  // Only advertise PKCE when the caller supplied a challenge, so existing
  // callers keep working unchanged.
  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }

  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
}

export async function exchangeCodeForTokens(
  db: Database.Database,
  code: string,
  origin?: string,
  codeVerifier?: string
): Promise<{ success: boolean; email?: string; name?: string; picture?: string; error?: string }> {
  ensureGoogleAuthTable(db);
  const { clientId, clientSecret } = getGoogleConfig(db);
  if (!clientId) {
    return { success: false, error: 'Missing Google Client ID' };
  }

  const redirectUri = getRedirectUri(origin);

  try {
    const params: Record<string, string> = {
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    };
    if (codeVerifier) {
      params.code_verifier = codeVerifier;
    }
    if (clientSecret) {
      params.client_secret = clientSecret;
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      return { success: false, error: `Google token exchange failed: ${errBody}` };
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token; // only returned when prompt=consent & offline
    const expiresIn = tokenData.expires_in || 3600;
    const expiryDate = Date.now() + expiresIn * 1000;

    // Fetch user profile
    let email: string | null = null;
    let name: string | null = null;
    let picture: string | null = null;

    try {
      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        email = userData.email || null;
        name = userData.name || null;
        picture = userData.picture || null;
      }
    } catch { /* intentionally ignored: non-fatal */ }

    const existing = db.prepare("SELECT id, refresh_token FROM google_auth WHERE id = 'primary'").get() as any;
    const finalRefreshToken = refreshToken || existing?.refresh_token || null;

    if (existing) {
      db.prepare(`
        UPDATE google_auth
        SET access_token = ?, refresh_token = COALESCE(?, refresh_token),
            expiry_date = ?, email = COALESCE(?, email), name = COALESCE(?, name),
            picture = COALESCE(?, picture), updated_at = CURRENT_TIMESTAMP
        WHERE id = 'primary'
      `).run(accessToken, finalRefreshToken, expiryDate, email, name, picture);
    } else {
      db.prepare(`
        INSERT INTO google_auth (id, client_id, client_secret, access_token, refresh_token, expiry_date, email, name, picture)
        VALUES ('primary', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(clientId, clientSecret || '', accessToken, finalRefreshToken, expiryDate, email, name, picture);
    }

    return {
      success: true,
      email: email || undefined,
      name: name || undefined,
      picture: picture || undefined
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error connecting to Google' };
  }
}

export async function getValidAccessToken(db: Database.Database): Promise<string | null> {
  ensureGoogleAuthTable(db);
  const row = db.prepare("SELECT access_token, refresh_token, expiry_date FROM google_auth WHERE id = 'primary'").get() as any;
  if (!row || !row.access_token) return null;

  // If token is still valid for at least 3 minutes, use it
  const now = Date.now();
  if (row.expiry_date && row.expiry_date - now > 3 * 60 * 1000) {
    return row.access_token;
  }

  // Otherwise, refresh token
  if (!row.refresh_token) {
    return row.access_token; // attempt with current if no refresh token
  }

  const { clientId, clientSecret } = getGoogleConfig(db);
  if (!clientId) return null;

  try {
    const params: Record<string, string> = {
      client_id: clientId,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token'
    };
    if (clientSecret) {
      params.client_secret = clientSecret;
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString()
    });

    if (!res.ok) return null;
    const data = await res.json();
    const newAccessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;
    const expiryDate = Date.now() + expiresIn * 1000;

    db.prepare(`
      UPDATE google_auth
      SET access_token = ?, expiry_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 'primary'
    `).run(newAccessToken, expiryDate);

    return newAccessToken;
  } catch {
    return null;
  }
}

export function getGoogleAuthStatus(db: Database.Database): GoogleAuthStatus {
  ensureGoogleAuthTable(db);
  const { clientId } = getGoogleConfig(db);
  const row = db.prepare("SELECT access_token, refresh_token, expiry_date, email, name, picture FROM google_auth WHERE id = 'primary'").get() as any;

  const isConnected = Boolean(row && (row.access_token || row.refresh_token));
  return {
    isConfigured: Boolean(clientId),
    isConnected,
    email: row?.email || null,
    name: row?.name || null,
    picture: row?.picture || null,
    expiresAt: row?.expiry_date ? new Date(row.expiry_date).toISOString() : null
  };
}

export function disconnectGoogle(db: Database.Database): void {
  ensureGoogleAuthTable(db);
  db.prepare(`
    UPDATE google_auth
    SET access_token = NULL, refresh_token = NULL, expiry_date = NULL,
        email = NULL, name = NULL, picture = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = 'primary'
  `).run();
}
