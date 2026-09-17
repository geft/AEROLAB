import { Router } from 'express';
import path from 'path';
import { getDatabase } from '../db/client.js';
import { importDirectory, importRunContent } from '../ingestion/importer.js';
import { convertFitToCsv, isFitBuffer } from '../ingestion/fit-parser.js';
import { checkAndRunScheduledBackup } from './database.js';

export const ingestRouter = Router();

// POST /api/ingest/scan - scan data/raw folder
ingestRouter.post('/scan', (req, res) => {
  try {
    const db = getDatabase();
    const rawDir = path.resolve(process.cwd(), 'data', 'raw');
    const results = importDirectory(db, rawDir);
    if (results.some(r => r.status === 'imported')) {
      setTimeout(() => {
        try { checkAndRunScheduledBackup(db); } catch (e) { console.error('[AutoBackup] Scan error:', e); }
      }, 500);
    }
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ingest/upload - upload CSV or FIT content directly
ingestRouter.post('/upload', (req, res) => {
  const { content, filename, force } = req.body;
  try {
    const db = getDatabase();
    if (!content) {
      return res.status(400).json({ error: 'Missing content field' });
    }

    let csvContent = content;
    let isFit = Boolean(filename && filename.toLowerCase().endsWith('.fit'));
    let fitBuffer: Buffer | null = null;

    // Auto-detect algorithm based on buffer magic bytes (.FIT at offset 8)
    if (Buffer.isBuffer(content)) {
      fitBuffer = content;
      if (isFitBuffer(fitBuffer)) isFit = true;
    } else if (typeof content === 'string') {
      const rawBase64 = content.includes(';base64,') ? content.split(';base64,')[1] : content;
      if (isFit) {
        try {
          fitBuffer = Buffer.from(rawBase64, 'base64');
        } catch {}
      } else {
        // Probe if string is base64-encoded FIT binary or base64-encoded CSV
        try {
          if (!rawBase64.startsWith('Activity') && !rawBase64.startsWith('timestamp') && !rawBase64.startsWith('time') && !rawBase64.startsWith('Date')) {
            const probe = Buffer.from(rawBase64.slice(0, 64), 'base64');
            if (isFitBuffer(probe)) {
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
        } catch {}
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

        const fitResult = convertFitToCsv(fitBuffer, filename || 'activity.fit');
        if (!fitResult.csv) {
          return res.json({
            result: {
              status: 'skipped_non_running',
              reason: 'FIT file is not a supported running session (e.g. daily wellness, sleep, or non-running activity)'
            }
          });
        }
        csvContent = fitResult.csv;
      } catch (fitErr: any) {
        return res.status(422).json({ error: `FIT parser error: ${fitErr.message}`, filename });
      }
    }

    const result = importRunContent(db, csvContent, filename || 'uploaded_run.csv', { force: Boolean(force) });
    if (result.status === 'error') {
      return res.status(422).json({ error: result.error || 'Failed to process run content', result });
    }
    if (result.status === 'imported') {
      setTimeout(() => {
        try { checkAndRunScheduledBackup(db); } catch (e) { console.error('[AutoBackup] Upload error:', e); }
      }, 500);
    }
    res.json({ result });
  } catch (err: any) {
    console.error(`[Ingest Error] Failed to import "${filename || 'unknown'}":`, err);
    res.status(500).json({ error: err.message || 'Server error during ingestion', filename });
  }
});

