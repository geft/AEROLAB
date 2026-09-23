import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { createServer } from '../../src/backend/server.js';
import { getDatabase, closeDatabase } from '../../src/backend/db/client.js';
import { isSafeBackupDirectory } from '../../src/backend/routes/database.js';

describe('Security Hardening Integration Tests', () => {
  let app: any;
  let testDir: string;
  let dbFilePath: string;
  let originalDbPath: string | undefined;

  beforeAll(() => {
    originalDbPath = process.env.DATABASE_PATH;
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-sec-test-'));
    dbFilePath = path.join(testDir, 'security-test.db');
    process.env.DATABASE_PATH = dbFilePath;

    getDatabase(dbFilePath);
    app = createServer();
  });

  afterAll(() => {
    closeDatabase();
    if (originalDbPath !== undefined) {
      process.env.DATABASE_PATH = originalDbPath;
    } else {
      delete process.env.DATABASE_PATH;
    }
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch { /* best-effort cleanup: safe to ignore */ }
  });

  describe('1. Standard Security HTTP Headers', () => {
    it('sets X-Content-Type-Options: nosniff', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets X-Frame-Options: SAMEORIGIN', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('sets Referrer-Policy: strict-origin-when-cross-origin', async () => {
      const res = await request(app).get('/api/health');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });
  });

  describe('2. CORS Origin Restrictions', () => {
    it('allows the fixed Vite development origin', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('rejects another localhost port', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'http://127.0.0.1:3000');

      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('blocks non-loopback unauthorized external origins', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://malicious-attacker.com');

      // The cors middleware throws an error for disallowed origins
      expect(res.status).toBe(403);
      expect(res.text).toContain('Origin not authorized');
    });
  });

  describe('3. Directory Validation & Path Traversal Protection', () => {
    it('isSafeBackupDirectory approves safe absolute paths', () => {
      const safeDir = path.join(testDir, 'safe-backups');
      expect(isSafeBackupDirectory(safeDir)).toBe(true);
    });

    it('isSafeBackupDirectory rejects relative paths', () => {
      expect(isSafeBackupDirectory('./backups')).toBe(false);
      expect(isSafeBackupDirectory('backups/test')).toBe(false);
    });

    it('isSafeBackupDirectory rejects path traversal containing ..', () => {
      expect(isSafeBackupDirectory(`${testDir}/../traversal`)).toBe(false);
      expect(isSafeBackupDirectory('C:\\backups\\..\\Windows')).toBe(false);
      expect(isSafeBackupDirectory('/tmp/../etc/passwd')).toBe(false);
    });

    it('isSafeBackupDirectory rejects system root directories', () => {
      expect(isSafeBackupDirectory('C:\\Windows')).toBe(false);
      expect(isSafeBackupDirectory('C:\\Program Files')).toBe(false);
      expect(isSafeBackupDirectory('/etc')).toBe(false);
      expect(isSafeBackupDirectory('/usr/bin')).toBe(false);
    });

    it('POST /api/database/settings rejects unsafe backupDirectory with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/database/settings')
        .send({
          backupDirectory: '../traversal-attack'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid or unsafe backup directory path');
    });

    it('POST /api/database/backup rejects path traversal in targetDirectory', async () => {
      const res = await request(app)
        .post('/api/database/backup')
        .send({
          targetDirectory: 'C:\\Windows\\System32\\..\\exploit'
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Invalid or unauthorized backup directory path');
    });
  });

  describe('4. Exported Snapshot Sanitization', () => {
    it('GET /api/database/download excludes retired OAuth credential tables', async () => {
      const downloadRes = await request(app)
        .get('/api/database/download')
        .responseType('blob');

      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers['content-type']).toContain('octet-stream');

      // Write the received binary blob to a temp file and inspect it with sqlite
      const tmpDownloaded = path.join(testDir, 'downloaded-snapshot.db');
      fs.writeFileSync(tmpDownloaded, downloadRes.body);

      const inspectDb = new Database(tmpDownloaded, { readonly: true });
      const tables = inspectDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      inspectDb.close();

      // Google Drive sync was retired; credentials must never appear in a snapshot.
      const names = tables.map(t => t.name);
      expect(names).not.toContain('google_auth');
      expect(names).not.toContain('google_tokens');
    });
  });

  describe('5. Database Restore Payload Size Limits', () => {
    it('POST /api/database/restore rejects payloads exceeding size threshold with 413', async () => {
      // Create a mock payload string that exceeds the max length check (150MB check)
      const oversizedPayload = {
        get length() {
          return 160 * 1024 * 1024;
        }
      } as any;

      const res = await request(app)
        .post('/api/database/restore')
        .send({ content: oversizedPayload });

      expect(res.status).toBe(413);
      expect(res.body.error).toContain('Database payload exceeds maximum permitted size');
    });
  });
});
