import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/client.js';
import {
  getGoogleConfig,
  saveGoogleCredentials,
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  getGoogleAuthStatus,
  disconnectGoogle
} from '../auth/google-auth.js';

export const authRouter = Router();

// GET /api/auth/google/url - get Google OAuth login consent URL
authRouter.get('/google/url', (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const origin = req.query.origin ? String(req.query.origin) : `${req.protocol}://${req.get('host')}`;
    const state = req.query.state ? String(req.query.state) : 'aerolab_auth';
    const result = getGoogleAuthUrl(db, origin, state);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ url: result.url });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate Google auth URL' });
  }
});

// GET /api/auth/google/callback - handle redirect from Google OAuth consent screen
authRouter.get('/google/callback', async (req: Request, res: Response) => {
  const { code, error, state } = req.query;
  if (error) {
    return res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; background: #0f172a; color: #f87171; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center; max-width: 480px; padding: 2rem; background: #1e293b; border-radius: 12px; border: 1px solid #334155;">
            <h2 style="margin-top: 0;">Authentication Cancelled</h2>
            <p style="color: #94a3b8; font-size: 0.9rem;">${error}</p>
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
    const origin = `${req.protocol}://${req.get('host')}`;
    const result = await exchangeCodeForTokens(db, code, origin);

    if (!result.success) {
      return res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; background: #0f172a; color: #f87171; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center; max-width: 480px; padding: 2rem; background: #1e293b; border-radius: 12px; border: 1px solid #334155;">
              <h2 style="margin-top: 0;">Connection Failed</h2>
              <p style="color: #94a3b8; font-size: 0.9rem;">${result.error || 'Failed to exchange token with Google'}</p>
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
            <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 1.5rem;">${result.email || 'Your account has been connected successfully'}</p>
            <p style="color: #64748b; font-size: 0.75rem;">This window will close automatically...</p>
            <script>
              try {
                if (window.opener) {
                  window.opener.postMessage({ type: 'AEROLAB_GOOGLE_AUTH_SUCCESS', email: ${JSON.stringify(result.email || '')} }, '*');
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
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'Both clientId and clientSecret are required' });
    }
    const db = getDatabase();
    saveGoogleCredentials(db, clientId, clientSecret);
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
