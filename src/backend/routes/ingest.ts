import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDatabase } from '../db/client.js';
import { importParsedRun, importRunContent, importRunFile } from '../ingestion/importer.js';
import { parseRunFit, isFitBuffer, isZipBuffer } from '../ingestion/fit-parser.js';
import { isSafeBackupDirectory, selectLocalFolder } from './database.js';
import { logger } from '../utils/logger.js';

export const ingestRouter = Router();

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

// POST /api/ingest/scan - import supported activity files from the configured folder.
ingestRouter.post('/scan', (req, res) => {
  try {
    const db = getDatabase();
    const directory = getGarminImportDirectory(db);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      return res.status(400).json({ code: 'IMPORT_FOLDER_UNAVAILABLE', error: 'The selected import folder is unavailable.' });
    }
    const files = fs.readdirSync(directory).filter(name => /\.(csv|fit|zip)$/i.test(name));
    const results = files.map(filename => ({
      ...importRunFile(db, path.join(directory, filename)),
      filename
    }));
    res.json({ directory, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ingest/upload - upload a single CSV or FIT run
ingestRouter.post('/upload', (req, res) => {
  const { content, filename, force } = req.body;
  try {
    const db = getDatabase();
    if (!content) {
      return res.status(400).json({ error: 'Missing content field' });
    }

    // Decode buffer if provided as base64 string
    let rawBuffer: Buffer | null = null;
    if (Buffer.isBuffer(content)) {
      rawBuffer = content;
    } else if (typeof content === 'string') {
      const rawBase64 = content.includes(';base64,') ? content.split(';base64,')[1] : content;
      try {
        rawBuffer = Buffer.from(rawBase64, 'base64');
      } catch { /* malformed input: caller falls back to a default */ }
    }

    let csvContent = content;
    let isFit = Boolean(filename && /\.(fit|zip)$/i.test(filename));
    let fitBuffer: Buffer | null = rawBuffer && (isFitBuffer(rawBuffer) || isZipBuffer(rawBuffer)) ? rawBuffer : null;

    // Auto-detect algorithm based on buffer magic bytes (.FIT at offset 8)
    if (Buffer.isBuffer(content)) {
      fitBuffer = content;
      if (isFitBuffer(fitBuffer) || isZipBuffer(fitBuffer)) isFit = true;
    } else if (typeof content === 'string') {
      const rawBase64 = content.includes(';base64,') ? content.split(';base64,')[1] : content;
      if (isFit) {
        try {
          fitBuffer = Buffer.from(rawBase64, 'base64');
        } catch { /* malformed input: caller falls back to a default */ }
      } else {
        // Probe if string is base64-encoded FIT binary or base64-encoded CSV
        try {
          // Only decode actual base64. Garmin CSV exports can start with '#'
          // metadata, and decoding that plain text can accidentally look like CSV.
          if (/^[A-Za-z0-9+/]+={0,2}$/.test(rawBase64.replace(/\s/g, ''))) {
            const probe = Buffer.from(rawBase64.slice(0, 64), 'base64');
            if (isFitBuffer(probe) || isZipBuffer(probe)) {
              isFit = true;
              fitBuffer = Buffer.from(rawBase64, 'base64');
            } else {
              // Decode base64 to check if it represents CSV text
              const decoded = Buffer.from(rawBase64, 'base64').toString('utf8');
              if (decoded.includes(',') && (decoded.includes('\n') || decoded.includes('\r'))) {
                csvContent = decoded;
              }
            }
          }
        } catch { /* malformed input: caller falls back to a default */ }
      }
    }

    if (isFit) {
      try {
        if (!fitBuffer) {
          if (Buffer.isBuffer(content)) {
            fitBuffer = content;
          } else if (typeof content === 'string') {
            const rawBase64 = content.includes(';base64,') ? content.split(';base64,')[1] : content;
            fitBuffer = Buffer.from(rawBase64, 'base64');
          } else {
            return res.status(400).json({ error: 'Invalid FIT content format' });
          }
        }

        const fitResult = parseRunFit(fitBuffer, filename || 'activity.fit');
        if (!fitResult) {
          return res.json({
            result: {
              status: 'skipped_non_running',
              reason: 'FIT file is not a supported running session (e.g. daily wellness, sleep, or non-running activity)'
            }
          });
        }
        const result = importParsedRun(db, fitResult, filename || 'activity.fit', { force: Boolean(force) });
        if (result.status === 'error') return res.status(422).json({ error: result.error, result });
        return res.json({ result });
      } catch (fitErr: any) {
        return res.status(422).json({ error: `FIT parser error: ${fitErr.message}`, filename,
          ...(/\.zip$/i.test(filename ?? '') || (fitBuffer && isZipBuffer(fitBuffer)) ? { code: 'ERR_ZIP_INVALID' } : {}) });
      }
    }

    const result = importRunContent(db, csvContent, filename || 'uploaded_run.csv', { force: Boolean(force) });
    if (result.status === 'error') {
      return res.status(422).json({ error: result.error || 'Failed to process run content', result });
    }
    res.json({ result });
  } catch (err: any) {
    logger.error('Ingest', `Failed to import "${filename || 'unknown'}"`, err);
    res.status(500).json({ error: err.message || 'Server error during ingestion', filename });
  }
});
