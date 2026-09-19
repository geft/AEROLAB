import { describe, it, expect } from 'vitest';
import zlib from 'zlib';
import { extractZipEntries, isZipBuffer } from '../../src/backend/ingestion/zip-extractor.js';

describe('Zero-Dependency ZIP Extractor Unit Tests', () => {
  function createTestZip(entries: Array<{ name: string; content: string; compress?: boolean }>): Buffer {
    const buffers: Buffer[] = [];

    for (const e of entries) {
      const nameBuf = Buffer.from(e.name, 'utf8');
      const rawContent = Buffer.from(e.content, 'utf8');
      const isDeflated = e.compress !== false;
      const dataBuf = isDeflated ? zlib.deflateRawSync(rawContent) : rawContent;

      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
      header.writeUInt16LE(20, 4); // version
      header.writeUInt16LE(0, 6); // flags
      header.writeUInt16LE(isDeflated ? 8 : 0, 8); // method (8 = deflate, 0 = stored)
      header.writeUInt16LE(0, 10); // time
      header.writeUInt16LE(0, 12); // date
      header.writeUInt32LE(0, 14); // crc32
      header.writeUInt32LE(dataBuf.length, 18); // compressed size
      header.writeUInt32LE(rawContent.length, 22); // uncompressed size
      header.writeUInt16LE(nameBuf.length, 26); // name length
      header.writeUInt16LE(0, 28); // extra length

      buffers.push(header, nameBuf, dataBuf);
    }

    return Buffer.concat(buffers);
  }

  it('detects zip buffer with isZipBuffer', () => {
    const zip = createTestZip([{ name: 'test.txt', content: 'hello' }]);
    expect(isZipBuffer(zip)).toBe(true);
    expect(isZipBuffer(Buffer.from('not-a-zip'))).toBe(false);
  });

  it('extracts deflated and stored files from zip buffer', () => {
    const zip = createTestZip([
      { name: 'activity1.csv', content: 'Date,Heart Rate\n2026-09-01,145', compress: true },
      { name: 'folder/activity2.csv', content: 'Date,Heart Rate\n2026-09-02,150', compress: false }
    ]);

    const extracted = extractZipEntries(zip);
    expect(extracted).toHaveLength(2);
    expect(extracted[0].filename).toBe('activity1.csv');
    expect(extracted[0].buffer.toString('utf8')).toContain('2026-09-01');
    expect(extracted[1].filename).toBe('activity2.csv');
    expect(extracted[1].buffer.toString('utf8')).toContain('2026-09-02');
  });
});
