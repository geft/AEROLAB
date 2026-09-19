import { Router } from 'express';
import path from 'path';
import { getDatabase } from '../db/client.js';
import { importDirectory, importRunContent } from '../ingestion/importer.js';
import { convertFitToCsv, isFitBuffer } from '../ingestion/fit-parser.js';
import { extractZipEntries, isZipBuffer } from '../ingestion/zip-extractor.js';
import { checkAndRunScheduledBackup } from './database.js';
import { logger } from '../utils/logger.js';

export const ingestRouter = Router();

// POST /api/ingest/scan - scan data/raw folder
ingestRouter.post('/scan', (req, res) => {
  try {
    const db = getDatabase();
    const rawDir = path.resolve(process.cwd(), 'data', 'raw');
    const results = importDirectory(db, rawDir);
    if (results.some(r => r.status === 'imported')) {
      setTimeout(() => {
        try { checkAndRunScheduledBackup(db); } catch (e) { logger.error('AutoBackup', 'Scan error', e); }
      }, 500);
    }
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ingest/upload - upload CSV, FIT or Garmin ZIP content directly
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
      } catch {}
    }

    // 1. Check for ZIP archive (e.g. Garmin Connect "Export All Data")
    const isZip = Boolean(
      (filename && filename.toLowerCase().endsWith('.zip')) ||
      (rawBuffer && isZipBuffer(rawBuffer))
    );

    if (isZip && rawBuffer) {
      const entries = extractZipEntries(rawBuffer);
      const zipResults: any[] = [];
      let importedCount = 0;

      for (const entry of entries) {
        const lowerName = entry.filename.toLowerCase();
        if (lowerName.endsWith('.fit')) {
          try {
            const fitResult = convertFitToCsv(entry.buffer, entry.filename);
            if (fitResult.csv) {
              const res = importRunContent(db, fitResult.csv, entry.filename, { force: Boolean(force) });
              zipResults.push(res);
              if (res.status === 'imported') importedCount++;
            } else {
              zipResults.push({ status: 'skipped_non_running', filename: entry.filename });
            }
          } catch (e: any) {
            zipResults.push({ status: 'error', filename: entry.filename, error: e.message });
          }
        } else if (lowerName.endsWith('.csv')) {
          try {
            const res = importRunContent(db, entry.buffer.toString('utf8'), entry.filename, { force: Boolean(force) });
            zipResults.push(res);
            if (res.status === 'imported') importedCount++;
          } catch (e: any) {
            zipResults.push({ status: 'error', filename: entry.filename, error: e.message });
          }
        }
      }

      if (importedCount > 0) {
        setTimeout(() => {
          try { checkAndRunScheduledBackup(db); } catch (e) { logger.error('AutoBackup', 'Zip upload error', e); }
        }, 500);
      }

      return res.json({
        result: {
          status: importedCount > 0 ? 'imported' : 'batch_completed',
          totalInZip: entries.length,
          processedCount: zipResults.length,
          importedCount,
          results: zipResults
        }
      });
    }

    let csvContent = content;
    let isFit = Boolean(filename && filename.toLowerCase().endsWith('.fit'));
    let fitBuffer: Buffer | null = rawBuffer && isFitBuffer(rawBuffer) ? rawBuffer : null;

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
        try { checkAndRunScheduledBackup(db); } catch (e) { logger.error('AutoBackup', 'Upload error', e); }
      }, 500);
    }
    res.json({ result });
  } catch (err: any) {
    logger.error('Ingest', `Failed to import "${filename || 'unknown'}"`, err);
    res.status(500).json({ error: err.message || 'Server error during ingestion', filename });
  }
});

