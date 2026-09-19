import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import zlib from 'zlib';
import { createServer } from '../../src/backend/server.js';
import { getDatabase, closeDatabase } from '../../src/backend/db/client.js';
import { getBenchmark, toCsv } from '../fixtures/benchmark-runs.js';

describe('ZIP Archive Bulk Ingestion Integration Tests', () => {
  let app: any;
  const run1Csv = toCsv(getBenchmark('bench-easy-60'));

  function createTestZip(files: Array<{ name: string; content: string }>): Buffer {
    const buffers: Buffer[] = [];
    for (const f of files) {
      const nameBuf = Buffer.from(f.name, 'utf8');
      const raw = Buffer.from(f.content, 'utf8');
      const deflated = zlib.deflateRawSync(raw);

      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0, 6);
      header.writeUInt16LE(8, 8); // Deflate
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(0, 12);
      header.writeUInt32LE(0, 14);
      header.writeUInt32LE(deflated.length, 18);
      header.writeUInt32LE(raw.length, 22);
      header.writeUInt16LE(nameBuf.length, 26);
      header.writeUInt16LE(0, 28);

      buffers.push(header, nameBuf, deflated);
    }
    return Buffer.concat(buffers);
  }

  beforeAll(() => {
    process.env.DATABASE_PATH = ':memory:';
    getDatabase(':memory:');
    app = createServer();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('POST /api/ingest/upload ingests runs directly from a Garmin export .zip archive', async () => {
    const zipBuf = createTestZip([
      { name: 'Garmin_Activities/run_one.csv', content: run1Csv }
    ]);

    const res = await request(app)
      .post('/api/ingest/upload')
      .send({
        content: `data:application/zip;base64,${zipBuf.toString('base64')}`,
        filename: 'garmin_export_archive.zip',
        force: true
      });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.result.totalInZip).toBe(1);
    expect(res.body.result.importedCount).toBe(1);
    expect(res.body.result.results[0].status).toBe('imported');
  });
});
