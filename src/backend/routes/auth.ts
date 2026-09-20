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
    return res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; background: #0f172a; color: #f87171; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center; max-width: 480px; padding: 2rem; background: #1e293b; border-radius: 12px; border: 1px solid #334155;">
            <h2 style="margin-top: 0;">Authentication Cancelled</h2>
            <p style="color: #94a3b8; font-size: 0.9rem;">${escapeHtml(error)}</p>
            <p><a href="/" style="color: #38bdf8; text-decoration: none;">Return to AEROLAB</a></p>
          </div>
        </body>
      </html>
    `);
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const db = getDatabase();
    const result = await exchangeCodeForTokens(db, code, login.origin, login.codeVerifier);

    if (!result.success) {
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; background: #0f172a; color: #f87171; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center; max-width: 480px; padding: 2rem; background: #1e293b; border-radius: 12px; border: 1px solid #334155;">
              <h2 style="margin-top: 0;">Connection Failed</h2>
              <p style="color: #94a3b8; font-size: 0.9rem;">${escapeHtml(result.error || 'Failed to exchange token with Google')}</p>
              <p><a href="/" style="color: #38bdf8; text-decoration: none;">Return to AEROLAB</a></p>
            </div>
          </body>
        </html>
      `);
    }

    // Return an HTML popup communicator that informs opener window and closes automatically
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Google Connected | AEROLAB</title>
        </head>
        <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center; max-width: 420px; padding: 2rem; background: #1e293b; border-radius: 16px; border: 1px solid #334155; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);">
            <div style="width: 50px; height: 50px; background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.4); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; color: #4ade80; font-size: 24px;">✓</div>
            <h2 style="margin: 0 0 0.5rem; font-size: 1.25rem;">Connected to Google</h2>
            <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 1.5rem;">${escapeHtml(result.email || 'Your account has been connected successfully')}</p>
            <p style="color: #64748b; font-size: 0.75rem;">This window will close automatically...</p>
            <script>
              try {
                if (window.opener) {
                  window.opener.postMessage({ type: 'AEROLAB_GOOGLE_AUTH_SUCCESS', email: ${JSON.stringify(result.email || '').replace(/</g, '\\u003c')} }, ${JSON.stringify(login.openerOrigin)});
                  setTimeout(function() { window.close(); }, 1200);
                } else {
                  setTimeout(function() { window.location.href = '/'; }, 1500);
                }
              } catch (e) {
                setTimeout(function() { window.location.href = '/'; }, 1500);
              }
            </script>
          </div>
        </body>
      </html>
    `);
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
