import { Router } from 'express';
import path from 'path';
import { getDatabase } from '../db/client.js';
import { importDirectory, importRunContent } from '../ingestion/importer.js';

export const ingestRouter = Router();

// POST /api/ingest/scan - scan data/raw folder
ingestRouter.post('/scan', (req, res) => {
  try {
    const db = getDatabase();
    const rawDir = path.resolve(process.cwd(), 'data', 'raw');
    const results = importDirectory(db, rawDir);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ingest/upload - upload CSV content directly
ingestRouter.post('/upload', (req, res) => {
  const { content, filename, force } = req.body;
  try {
    const db = getDatabase();
    if (!content) {
      return res.status(400).json({ error: 'Missing content field' });
    }
    const result = importRunContent(db, content, filename || 'uploaded_run.csv', { force: Boolean(force) });
    if (result.status === 'error') {
      return res.status(422).json({ error: result.error || 'Failed to process run content', result });
    }
    res.json({ result });
  } catch (err: any) {
    console.error(`[Ingest Error] Failed to import "${filename || 'unknown'}":`, err);
    res.status(500).json({ error: err.message || 'Server error during ingestion', filename });
  }
});

