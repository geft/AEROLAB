import { gzipSync } from 'node:zlib';
import { decode, encode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import { decodeSnapshot, decodeSnapshotArchive, encodeSnapshot, readSnapshotSection } from '../../src/shared/snapshot-codec.js';
import { snapshotFixture } from '../fixtures/snapshot.js';

describe('compact snapshot codec', () => {
  it('preserves metric precision, nulls, summary data and differences in activity details', () => {
    const source = snapshotFixture();
    const decoded = decodeSnapshot(gzipSync(encodeSnapshot(source), { level: 9 }));
    expect(decoded.activities).toEqual(source.activities);
    const detail = decoded.details['run-1'];
    expect(detail.activity).toEqual(source.details['run-1'].activity);
    expect(detail.records).toEqual([
      { elapsed_seconds: 0, heart_rate: null, speed_mps: 2.1234567891011, altitude_m: 8.800000000000011, distance_m: 0, cadence: null },
      { elapsed_seconds: 30, heart_rate: 150, speed_mps: 3.1234567891011, altitude_m: null, distance_m: 90.1234567891011, cadence: null },
    ]);
    expect(detail.splits).toEqual(source.details['run-1'].splits);
    expect(detail.intervals).toEqual(source.details['run-1'].intervals);
    expect(detail.coachSummary).toEqual(source.details['run-1'].coachSummary);
    expect(detail).not.toHaveProperty('fitMetadata');
  });

  it('keeps telemetry columnar while reading summaries and only expands requested details', () => {
    const archive = decodeSnapshotArchive(gzipSync(encodeSnapshot(snapshotFixture())));
    const before = structuredClone(archive);
    expect(readSnapshotSection(archive, 'activities')).toEqual(before.activities);
    expect(archive.details['run-1'].records[0]).toEqual([0, 30]);
    expect(readSnapshotSection(archive, 'details', 'run-1')).toHaveProperty('records.1.elapsed_seconds', 30);
    expect(archive).toEqual(before);
    expect(readSnapshotSection(archive, 'details', 'missing')).toBeUndefined();
  });

  it('reads MessagePack that Fetch has already decompressed and rejects older JSON', () => {
    const source = snapshotFixture();
    const json = new TextEncoder().encode(JSON.stringify({ ...source, schemaVersion: 1 }));
    expect(() => decodeSnapshot(json)).toThrow();
    expect(() => decodeSnapshot(gzipSync(json))).toThrow();
    expect(decodeSnapshot(encodeSnapshot(source)).details['run-1'].records).toHaveLength(2);
  });

  it('rejects incompatible versions, truncated compression and mismatched telemetry columns', () => {
    expect(() => decodeSnapshot(encode({ ...snapshotFixture(), schemaVersion: 99 }))).toThrow('Unsupported snapshot schema version');
    const compressed = gzipSync(encodeSnapshot(snapshotFixture()));
    expect(() => decodeSnapshot(compressed.subarray(0, Math.floor(compressed.length / 2)))).toThrow();
    const wire = decode(encodeSnapshot(snapshotFixture())) as Record<string, unknown>;
    const details = wire.details as Record<string, { records: Array<Array<number | null>> }>;
    details['run-1'].records[1].pop();
    expect(() => decodeSnapshot(encode(wire))).toThrow('Invalid telemetry values');
    delete wire.recordFields;
    expect(() => decodeSnapshot(encode(wire))).toThrow('missing its telemetry format');
  });
});
