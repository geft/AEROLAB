import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDatabase } from '../db/client.js';
import { importParsedRun, importParsedRuns, importRunFile, type ImportResult } from '../ingestion/importer.js';
import { IMPORT_BATCH_SIZE } from '../../shared/import-batch.js';
import { parseRunFit, isFitBuffer, isZipBuffer } from '../ingestion/fit-parser.js';
import { isSafeBackupDirectory, selectLocalFolder } from './database.js';
import { logger } from '../utils/logger.js';
import { createImportJob, getImportJob, stageImportFiles, finishImportJob, cancelImportJob } from '../jobs/import-job.js';
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

ingestRouter.post('/jobs', async (req, res) => {
  if (!Number.isSafeInteger(req.body?.totalFiles) || req.body.totalFiles < 1) return res.status(400).json({ error: 'Invalid file count' });
  try {
    return res.status(201).json(await createImportJob(getDatabase().name, req.body.totalFiles, Boolean(req.body.force)));
  } catch (error) {
    return res.status(409).json({ code: 'ERR_IMPORT_BUSY', error: error instanceof Error ? error.message : String(error) });
  }
});
ingestRouter.get('/jobs/:id', (req, res) => {
  try { return res.json(getImportJob(req.params.id)); }
  catch { return res.status(404).json({ error: 'Import job not found' }); }
});
ingestRouter.post('/jobs/:id/files', async (req, res) => {
  try {
    if (!Array.isArray(req.body.files)) return res.status(400).json({ error: 'Invalid import files' });
    return res.json(await stageImportFiles(req.params.id, req.body.files));
  } catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
ingestRouter.post('/jobs/:id/finish', async (req, res) => {
  try { return res.status(202).json(await finishImportJob(req.params.id, req.body?.totalFiles)); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
});
ingestRouter.delete('/jobs/:id', async (req, res) => {
  try { await cancelImportJob(req.params.id); return res.json({ cancelled: true }); }
  catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : String(error) }); }
});

function getGarminImportDirectory(db: ReturnType<typeof getDatabase>): string {
  const fallback = path.join(os.homedir(), 'Downloads');
  try {
    const row = db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'").get() as { preferences_json?: string } | undefined;
    if (row?.preferences_json) {
      const preferences = JSON.parse(row.preferences_json) as { garminImportDirectory?: unknown };
      if (typeof preferences.garminImportDirectory === 'string' && path.isAbsolute(preferences.garminImportDirectory)) {
        return path.normalize(preferences.garminImportDirectory);
      }
    }
  } catch { /* malformed preferences use the platform Downloads folder */ }
  return fallback;
}

function saveGarminImportDirectory(db: ReturnType<typeof getDatabase>, directory: string): void {
  const row = db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'").get() as { preferences_json?: string } | undefined;
  const preferences = row?.preferences_json ? JSON.parse(row.preferences_json) as Record<string, unknown> : {};
  preferences.garminImportDirectory = path.normalize(directory);
  db.prepare("UPDATE athlete_profile SET preferences_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'primary'").run(JSON.stringify(preferences));
}

// GET /api/ingest/settings - return the folder used by Scan Downloads.
ingestRouter.get('/settings', (_req, res) => {
  try {
    const directory = getGarminImportDirectory(getDatabase());
    res.json({ directory, exists: fs.existsSync(directory) && fs.statSync(directory).isDirectory() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load import settings' });
  }
});

// POST /api/ingest/settings - choose and persist the Garmin export folder.
ingestRouter.post('/settings', (req, res) => {
  try {
    const directory = req.body?.directory;
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || !isSafeBackupDirectory(directory)) {
      return res.status(400).json({ error: 'Choose an absolute, safe folder path.' });
    }
    const normalized = path.resolve(directory);
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
      return res.status(400).json({ error: 'Choose an existing folder.' });
    }
    const db = getDatabase();
    saveGarminImportDirectory(db, normalized);
    res.json({ directory: normalized, exists: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save import settings' });
  }
});

// POST /api/ingest/select-folder - open the native folder chooser for import source.
ingestRouter.post('/select-folder', async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 120) : 'Choose import folder';
    const folder = await selectLocalFolder(title);
    if (!folder) return res.json({ folder: null, cancelled: true });
    const normalized = path.resolve(folder);
    if (!isSafeBackupDirectory(normalized) || !fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
      return res.status(400).json({ error: 'Selected folder is invalid or unavailable.' });
    }
    res.json({ folder: normalized });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to select import folder' });
  }
});

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

// POST /api/ingest/scan - import supported activity files from the configured folder.
ingestRouter.post('/scan', (req, res) => {
  try {
    const db = getDatabase();
    const directory = getGarminImportDirectory(db);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      return res.status(400).json({ code: 'IMPORT_FOLDER_UNAVAILABLE', error: 'The selected import folder is unavailable.' });
    }
    const files = fs.readdirSync(directory).filter(name => /\.(fit|zip)$/i.test(name));
    const results = files.map(filename => ({
      ...importRunFile(db, path.join(directory, filename)),
      filename
    }));
    res.json({ directory, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ingest/upload - native FIT or single-activity Garmin ZIP
ingestRouter.post('/upload-batch', (req, res) => {
  const { files, force } = req.body;
  if (!Array.isArray(files) || !files.length || files.length > IMPORT_BATCH_SIZE ||
      files.some(file => !file || typeof file.content !== 'string' || !file.content || typeof file.filename !== 'string')) {
    return res.status(400).json({ error: 'Invalid import batch.' });
  }
  try {
    const results: ImportResult[] = new Array(files.length);
    const parsedFiles: Array<{ parsed: NonNullable<ReturnType<typeof parseRunFit>>; filename: string; index: number }> = [];
    for (let index = 0; index < files.length; index++) {
      const { content, filename } = files[index];
      try {
        const buffer = Buffer.from(content.includes(';base64,') ? content.split(';base64,')[1] : content, 'base64');
        if (!/\.(fit|zip)$/i.test(filename) && !isFitBuffer(buffer) && !isZipBuffer(buffer)) throw new Error('Import a FIT or Garmin activity ZIP file.');
        const parsed = parseRunFit(buffer, filename);
        if (parsed) parsedFiles.push({ parsed, filename, index });
        else results[index] = { status: 'skipped_non_running', reason: 'non_run' };
      } catch (error) {
        results[index] = { status: 'error', error: error instanceof Error ? error.message : String(error) };
      }
    }
    if (parsedFiles.length) {
      const imported = importParsedRuns(getDatabase(), parsedFiles, { force: Boolean(force) });
      parsedFiles.forEach((file, index) => { results[file.index] = imported[index]; });
    }
    return res.json({ results });
  } catch (error) {
    logger.error('Ingest', 'Batch import failed', error);
    return res.status(422).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

ingestRouter.post('/upload', (req, res) => {
  const { content, filename, force } = req.body;
  if (!content) return res.status(400).json({ error: 'Missing content field' });
  if (!Buffer.isBuffer(content) && typeof content !== 'string') {
    return res.status(400).json({ error: 'Invalid FIT content format' });
  }
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(
    content.includes(';base64,') ? content.split(';base64,')[1] : content, 'base64');
  const nativeExtension = typeof filename === 'string' && /\.(fit|zip)$/i.test(filename);
  if (!nativeExtension && !isFitBuffer(buffer) && !isZipBuffer(buffer)) {
    return res.status(415).json({ code: 'ERR_IMPORT_FORMAT', error: 'Import a FIT or Garmin activity ZIP file. CSV is available for export only.' });
  }
  try {
    const parsed = parseRunFit(buffer, filename || 'activity.fit');
    if (!parsed) return res.json({ result: {
      status: 'skipped_non_running',
      reason: 'FIT file is not a supported running session (e.g. daily wellness, sleep, or non-running activity)'
    } });
    const result = importParsedRun(getDatabase(), parsed, filename || 'activity.fit', { force: Boolean(force) });
    if (result.status === 'error') return res.status(422).json({ error: result.error, result });
    return res.json({ result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Ingest', `Failed to import "${filename || 'unknown'}"`, error);
    return res.status(422).json({ error: `FIT parser error: ${message}`, filename,
      ...(/\.zip$/i.test(filename ?? '') || isZipBuffer(buffer) ? { code: 'ERR_ZIP_INVALID' } : {}) });
  }
});
