import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { getDatabase } from '../db/client.js';
import {
  saveGoogleCredentials,
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  getGoogleAuthStatus,
  disconnectGoogle,
  generateCodeVerifier,
  codeChallengeS256
} from '../auth/google-auth.js';

export const authRouter = Router();

const pendingLogins = new Map<string, { browserToken: string; origin: string; openerOrigin: string; expiresAt: number; codeVerifier: string }>();
const stateCookie = 'aerolab_oauth_state';
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/api/auth/google' };
const loginLifetimeMs = 10 * 60 * 1000;

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]!));
}

/**
 * Turn a raw Google token-endpoint error into guidance the athlete can act on.
 */
function describeOAuthFailure(rawError: string): string {
  if (/client_secret is missing/i.test(rawError)) {
    return 'Google rejected the token exchange because this OAuth client is a "Web application" client, and those require a client secret. Use a "Desktop app" OAuth client instead (PKCE alone is then enough), or provide the secret through the GOOGLE_CLIENT_SECRET environment variable.';
  }
  if (/redirect_uri_mismatch/i.test(rawError)) {
    return 'Google rejected the redirect URI. Add the exact callback URL shown in the AEROLAB address bar to the OAuth client\'s authorised redirect URIs.';
  }
  if (/invalid_grant/i.test(rawError)) {
    return 'That authorisation code was already used or has expired. Please start the sign-in again.';
  }
  return rawError;
}

/**
 * Renders the pop-up window shown after Google redirects back to AEROLAB.
 *
 * The pop-up reports its outcome to the opener and then closes itself. It never
 * navigates to the app root: doing so rendered the entire dashboard inside the
 * small pop-up window, which looked broken.
 */
function renderOAuthPopup(options: {
  outcome: 'success' | 'failure';
  heading: string;
  message: string;
  accent: string;
  glyph: string;
  openerOrigin: string;
  email?: string;
}): string {
  const payload = JSON.stringify({
    type: options.outcome === 'success' ? 'AEROLAB_GOOGLE_AUTH_SUCCESS' : 'AEROLAB_GOOGLE_AUTH_FAILURE',
    email: options.email || '',
    error: options.outcome === 'success' ? '' : options.message
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
  <head><title>${escapeHtml(options.heading)} | AEROLAB</title></head>
  <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
    <div style="text-align: center; max-width: 460px; padding: 2rem; background: #1e293b; border-radius: 16px; border: 1px solid #334155;">
      <div style="width: 50px; height: 50px; background: ${options.accent}22; border: 1px solid ${options.accent}66; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; color: ${options.accent}; font-size: 24px;">${options.glyph}</div>
      <h2 style="margin: 0 0 0.5rem; font-size: 1.25rem;">${escapeHtml(options.heading)}</h2>
      <p style="color: #94a3b8; font-size: 0.85rem; margin: 0 0 1rem; line-height: 1.5;">${escapeHtml(options.message)}</p>
      <p id="close-hint" style="display: none; color: #64748b; font-size: 0.75rem; margin: 0;">This window can be closed. Your AEROLAB tab is still open.</p>
    </div>
    <script>
      (function () {
        var payload = ${payload};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, ${JSON.stringify(options.openerOrigin)});
          }
        } catch (e) {}
        try { window.close(); } catch (e) {}
        window.setTimeout(function () {
          var hint = document.getElementById('close-hint');
          if (hint) hint.style.display = 'block';
        }, 400);
      })();
    </script>
  </body>
</html>`;
}

// GET /api/auth/google/url - get Google OAuth login consent URL
authRouter.get('/google/url', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const origin = req.query.origin ? String(req.query.origin) : `${req.protocol}://${req.get('host')}`;
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname)
      || parsedOrigin.origin !== origin) {
      return res.status(400).json({ error: 'OAuth redirect must use a local HTTP origin.' });
    }
    for (const [key, login] of pendingLogins) {
      if (login.expiresAt <= Date.now()) pendingLogins.delete(key);
    }
    if (pendingLogins.size >= 1000) {
      return res.status(429).json({ error: 'Too many pending sign-in attempts. Please try again later.' });
    }
    const state = randomBytes(32).toString('hex');
    const browserToken = randomBytes(32).toString('hex');
    // PKCE: the verifier is kept server-side only; the challenge goes to Google.
    const codeVerifier = generateCodeVerifier();
    // In development the opener is served by Vite, while Google's callback uses the API port.
    const openerOrigin = new URL(req.get('origin') || req.get('referer') || origin).origin;
    const opener = new URL(openerOrigin);
    if (opener.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(opener.hostname)) {
      return res.status(400).json({ error: 'OAuth sign-in must start from a local HTTP origin.' });
    }
    const result = getGoogleAuthUrl(db, origin, state, codeChallengeS256(codeVerifier));
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    pendingLogins.set(state, { browserToken, origin, openerOrigin, expiresAt: Date.now() + loginLifetimeMs, codeVerifier });
    res.cookie(stateCookie, browserToken, { ...cookieOptions, maxAge: loginLifetimeMs });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ url: result.url });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate Google auth URL' });
  }
});

// GET /api/auth/google/callback - handle redirect from Google OAuth consent screen
authRouter.get('/google/callback', async (req: Request, res: Response) => {
  const { code, error, state } = req.query;
  const login = typeof state === 'string' ? pendingLogins.get(state) : undefined;
  const browserToken = req.headers.cookie?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${stateCookie}=`))?.slice(stateCookie.length + 1);
  if (!login || login.expiresAt <= Date.now() || browserToken !== login.browserToken) {
    return res.status(400).json({ error: 'Invalid or expired OAuth state. Please start sign-in again.' });
  }
  pendingLogins.delete(state as string);
  res.clearCookie(stateCookie, cookieOptions);
  res.setHeader('Cache-Control', 'no-store');
  if (error) {
    return res.status(400).send(renderOAuthPopup({
      outcome: 'failure',
      heading: 'Authentication Cancelled',
      message: String(error),
      accent: '#f87171',
      glyph: '!',
      openerOrigin: login.openerOrigin
    }));
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const db = getDatabase();
    const result = await exchangeCodeForTokens(db, code, login.origin, login.codeVerifier);

    if (!result.success) {
      return res.status(400).send(renderOAuthPopup({
        outcome: 'failure',
        heading: 'Connection Failed',
        message: describeOAuthFailure(result.error || 'Failed to exchange token with Google'),
        accent: '#f87171',
        glyph: '!',
        openerOrigin: login.openerOrigin
      }));
    }

    // Report success to the opener, then close the pop-up.
    res.send(renderOAuthPopup({
      outcome: 'success',
      heading: 'Connected to Google',
      message: result.email || 'Your account has been connected successfully.',
      accent: '#4ade80',
      glyph: '✓',
      openerOrigin: login.openerOrigin,
      email: result.email
    }));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Server error exchanging Google OAuth code' });
  }
});

// GET /api/auth/google/status - check Google connection status
authRouter.get('/google/status', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const status = getGoogleAuthStatus(db);
    res.json({ status });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get Google auth status' });
  }
});

// POST /api/auth/google/credentials - configure custom Google Client ID & Client Secret
authRouter.post('/google/credentials', (req: Request, res: Response) => {
  try {
    const { clientId, clientSecret } = req.body || {};
    if (!clientId) {
      return res.status(400).json({ error: 'Google Client ID is required' });
    }
    const db = getDatabase();
    saveGoogleCredentials(db, clientId, clientSecret || '');
    const status = getGoogleAuthStatus(db);
    res.json({ status: 'ok', authStatus: status });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save Google credentials' });
  }
});

// POST /api/auth/google/disconnect - disconnect Google account and remove stored tokens
authRouter.post('/google/disconnect', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    disconnectGoogle(db);
    const status = getGoogleAuthStatus(db);
    res.json({ status: 'ok', authStatus: status });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to disconnect Google' });
  }
});
