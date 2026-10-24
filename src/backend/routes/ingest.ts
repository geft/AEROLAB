import { Router } from 'express';
import { getDatabase } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { GARMIN_SYNC_BATCH_SIZE } from '../../shared/garmin.js';
import { GarminApiError, garminKeyExpiryFromToken, obtainGarminAccessToken, resetGarminTokenCache } from '../garmin/client.js';
import {
  clearStoredGarminCredentials,
  getGarminKeyStatus,
  normalizeGarminExpiry,
  resolveGarminCredentials,
  saveGarminApiKey,
  saveGarminKeyExpiry
} from '../garmin/credentials.js';
import { syncGarmin } from '../garmin/sync.js';

export const ingestRouter = Router();
let garminSyncRunning = false;

function garminErrorResponse(res: import('express').Response, error: unknown) {
  if (error instanceof GarminApiError) {
    return res.status(error.status).json({ code: error.code, error: error.message });
  }
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'DATABASE_BUSY') {
    return res.status(409).json({ code: 'ERR_IMPORT_BUSY', error: 'Wait for the current database operation to finish.' });
  }
  logger.error('Garmin', 'Garmin request failed', error);
  return res.status(500).json({ error: error instanceof Error ? error.message : 'Garmin request failed' });
}

// --- Garmin Connect Personal API ------------------------------------------------

// GET /api/ingest/garmin/status - whether a key is available and how long it lasts.
ingestRouter.get('/garmin/status', (_req, res) => {
  try {
    res.json({ key: getGarminKeyStatus() });
  } catch (error) {
    garminErrorResponse(res, error);
  }
});

// PUT /api/ingest/garmin/key - validate and store a Personal API key.
ingestRouter.put('/garmin/key', async (req, res) => {
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  let requestedExpiry: string | null;
  try {
    requestedExpiry = normalizeGarminExpiry(req.body?.expiresAt);
  } catch {
    return res.status(400).json({ code: 'ERR_INVALID_GARMIN_EXPIRY', error: 'Enter a valid Garmin key expiry date.' });
  }

  // An empty key updates only the recorded expiry of an already configured
  // key. Environment keys are never copied to disk; an expiry supplied through
  // GARMIN_API_KEY_EXPIRY is authoritative and is never mirrored either.
  if (!apiKey) {
    const current = getGarminKeyStatus();
    if (!current.configured) {
      return res.status(400).json({ code: 'GARMIN_KEY_MISSING', error: 'Enter a Garmin Personal API key.' });
    }
    try {
      if (current.source === 'stored') {
        const stored = resolveGarminCredentials();
        if (!stored?.apiKey) {
          return res.status(400).json({ code: 'GARMIN_KEY_MISSING', error: 'Enter a Garmin Personal API key.' });
        }
        saveGarminApiKey(stored.apiKey, requestedExpiry);
      } else {
        saveGarminKeyExpiry(requestedExpiry);
      }
      return res.json({ key: getGarminKeyStatus() });
    } catch (error) {
      return garminErrorResponse(res, error);
    }
  }

  try {
    // Never store a key Garmin rejects. Validate with a fresh token rather than
    // a cached one, which could predate a revocation.
    resetGarminTokenCache();
    const token = await obtainGarminAccessToken(apiKey);
    const detectedExpiry = garminKeyExpiryFromToken(token);
    const effectiveExpiry = requestedExpiry && detectedExpiry
      ? new Date(Math.min(Date.parse(requestedExpiry), Date.parse(detectedExpiry))).toISOString()
      : requestedExpiry ?? detectedExpiry;
    saveGarminApiKey(apiKey, effectiveExpiry);
    return res.json({ key: getGarminKeyStatus() });
  } catch (error) {
    return garminErrorResponse(res, error);
  }
});

// DELETE /api/ingest/garmin/key - forget the locally stored key. An environment
// key is owned by the shell, so it remains in effect after this call.
ingestRouter.delete('/garmin/key', (_req, res) => {
  try {
    clearStoredGarminCredentials();
    res.json({ key: getGarminKeyStatus() });
  } catch (error) {
    garminErrorResponse(res, error);
  }
});

// POST /api/ingest/garmin/sync - fetch the next batch of FIT files.
ingestRouter.post('/garmin/sync', async (req, res) => {
  if (garminSyncRunning) {
    return res.status(409).json({ code: 'ERR_IMPORT_BUSY', error: 'A Garmin sync is already running.' });
  }
  garminSyncRunning = true;
  try {
    const limit = Number(req.body?.limit);
    const response = await syncGarmin(getDatabase(), {
      limit: Number.isFinite(limit) ? limit : GARMIN_SYNC_BATCH_SIZE
    });
    res.json(response);
  } catch (error) {
    garminErrorResponse(res, error);
  } finally {
    garminSyncRunning = false;
  }
});
