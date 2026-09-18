import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  ensureGoogleAuthTable,
  getGoogleConfig,
  saveGoogleCredentials,
  getGoogleAuthUrl,
  getGoogleAuthStatus,
  disconnectGoogle,
  DEFAULT_GOOGLE_CLIENT_ID
} from '../../src/backend/auth/google-auth.js';

describe('Google OAuth & Auth Helper Unit Tests', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    ensureGoogleAuthTable(db);
  });

  it('saves and retrieves custom Google OAuth credentials in SQLite', () => {
    saveGoogleCredentials(db, 'test-client-id-123.apps.googleusercontent.com', 'test-client-secret-xyz');

    const config = getGoogleConfig(db);
    expect(config.clientId).toBe('test-client-id-123.apps.googleusercontent.com');
    expect(config.clientSecret).toBe('test-client-secret-xyz');

    const status = getGoogleAuthStatus(db);
    expect(status.isConfigured).toBe(true);
    expect(status.isConnected).toBe(false);
  });

  it('generates a valid Google OAuth consent URL with drive.file and userinfo scopes', () => {
    saveGoogleCredentials(db, 'sample-client.apps.googleusercontent.com', 'sample-secret');

    const result = getGoogleAuthUrl(db, 'http://localhost:3001');
    expect(result.error).toBeUndefined();
    expect(result.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(result.url).toContain('client_id=sample-client.apps.googleusercontent.com');
    expect(result.url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fapi%2Fauth%2Fgoogle%2Fcallback');
    expect(result.url).toContain('access_type=offline');
    expect(result.url).toContain('drive.file');
  });

  it('returns error when generating URL without configured Client ID', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const freshDb = new Database(':memory:');
    ensureGoogleAuthTable(freshDb);

    const result = getGoogleAuthUrl(freshDb, 'http://localhost:3001');
    expect(result.error).toBeDefined();
    expect(result.url).toBe('');
  });

  it('clears tokens upon disconnect while retaining credentials', () => {
    saveGoogleCredentials(db, 'client-1', 'secret-1');

    // Manually insert active token state
    db.prepare(`
      UPDATE google_auth
      SET access_token = 'mock_access', refresh_token = 'mock_refresh', email = 'runner@example.com'
      WHERE id = 'primary'
    `).run();

    let status = getGoogleAuthStatus(db);
    expect(status.isConnected).toBe(true);
    expect(status.email).toBe('runner@example.com');

    disconnectGoogle(db);

    status = getGoogleAuthStatus(db);
    expect(status.isConnected).toBe(false);
    expect(status.email).toBeNull();
    expect(status.isConfigured).toBe(true);
  });

  it('exposes the default AEROLAB Google Client ID constant', () => {
    expect(DEFAULT_GOOGLE_CLIENT_ID).toBe('805691757155-m96h9kbbb1v1pno1qa3bfq5bn1t5k91i.apps.googleusercontent.com');
  });

  it('allows saving Google credentials without a clientSecret', () => {
    saveGoogleCredentials(db, DEFAULT_GOOGLE_CLIENT_ID);
    const config = getGoogleConfig(db);
    expect(config.clientId).toBe(DEFAULT_GOOGLE_CLIENT_ID);
    expect(config.clientSecret).toBeNull();
    const status = getGoogleAuthStatus(db);
    expect(status.isConfigured).toBe(true);
  });
});
