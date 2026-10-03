import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSnapshot } from '../../src/frontend/api/snapshot-loading.js';
import type { SnapshotLoadingProgress } from '../../src/frontend/api/snapshot-loading.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import { decodeSnapshotArchive, encodeSnapshot, readSnapshotSection } from '../../src/shared/snapshot-codec.js';
import { snapshotFixture } from '../fixtures/snapshot.js';

afterEach(() => vi.unstubAllGlobals());
const snapshot = { schemaVersion: 2, generatedAt: '2026-10-03', activities: [], details: {}, profile: { name: '跑者' },
  bestEfforts: {}, progressByRunType: {}, thresholdsByRunType: {}, volume: {}, trainingLoadByDays: {} };

const snapshotBytes = gzipSync(encodeSnapshot(snapshot));
const archive = decodeSnapshotArchive(snapshotBytes);

function response(headers: HeadersInit): Response {
  const bytes = snapshotBytes;
  const split = 7;
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close(); }
  }), { headers });
}

describe('snapshot streaming progress', () => {
  it('streams gzip bytes with real progress and decodes MessagePack without expanding telemetry', async () => {
    const bytes = gzipSync(encodeSnapshot(snapshotFixture()), { level: 9 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes.subarray(0, 7)); controller.enqueue(bytes.subarray(7)); controller.close(); },
    }), { headers: { 'Content-Length': String(bytes.length) } })));
    const progress: SnapshotLoadingProgress[] = [];
    const archive = await loadSnapshot(value => progress.push(value));
    expect(progress.some(value => value.percent !== undefined && value.percent > 0 && value.percent < 100)).toBe(true);
    expect(progress.at(-2)).toEqual({ stage: 'downloading', percent: 100 });
    expect(archive.details['run-1'].records[0]).toEqual([0, 30]);
    expect(readSnapshotSection(archive, 'details', 'run-1')).toHaveProperty('records.1.speed_mps', 3.1234567891011);
  });

  it('reads MessagePack when the host sets gzip Content-Encoding and Fetch has decompressed it', async () => {
    const compressed = gzipSync(encodeSnapshot(snapshotFixture()));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(gunzipSync(compressed), {
      headers: { 'Content-Encoding': 'gzip', 'Content-Length': String(compressed.length) },
    })));
    const progress: SnapshotLoadingProgress[] = [];
    expect((await loadSnapshot(value => progress.push(value))).activities).toHaveLength(1);
    expect(progress.every(value => value.percent === undefined)).toBe(true);
  });

  it('requires the binary artifact without requesting older JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadSnapshot(() => {})).rejects.toMatchObject({ code: 'ERR_SNAPSHOT_MISSING' });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/snapshot.msgpack.gz']);
  });
  it('reports real download percentages and preserves Chinese text across binary chunks', async () => {
    const size = snapshotBytes.length;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ 'Content-Length': String(size) })));
    const progress: SnapshotLoadingProgress[] = [];
    expect(await loadSnapshot(value => progress.push(value))).toEqual(archive);
    expect(progress.some(value => value.percent !== undefined && value.percent > 0 && value.percent < 100)).toBe(true);
    expect(progress.at(-2)).toEqual({ stage: 'downloading', percent: 100 });
    expect(progress.at(-1)).toEqual({ stage: 'preparing' });
  });

  const unknownSizes: HeadersInit[] = [{}, { 'Content-Length': '10', 'Content-Encoding': 'gzip' }, { 'Content-Length': 'invalid' }];
  it.each(unknownSizes)('avoids invented percentages when sizes are unknown or compressed: %j', async headers => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(headers)));
    const progress: SnapshotLoadingProgress[] = [];
    await loadSnapshot(value => progress.push(value));
    expect(progress.every(value => value.percent === undefined)).toBe(true);
    expect(progress.at(-1)?.stage).toBe('preparing');
  });

  it('rejects missing and malformed binary snapshots', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(loadSnapshot(() => {})).rejects.toMatchObject({ code: 'ERR_SNAPSHOT_MISSING' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad binary')));
    await expect(loadSnapshot(() => {})).rejects.toThrow();
  });
});

describe('persistent snapshot cache', () => {
  function storage() {
    let saved: Response | undefined;
    const cache = {
      put: vi.fn(async (_key: string, value: Response) => { saved = value; }),
      match: vi.fn(async () => saved?.clone())
    };
    vi.stubGlobal('caches', { open: vi.fn().mockResolvedValue(cache) });
    return cache;
  }

  it('persists the first download and reopens it offline without a service worker controller', async () => {
    const cache = storage();
    const fetchMock = vi.fn().mockResolvedValue(new Response(gunzipSync(snapshotBytes), { headers: { 'Content-Encoding': 'gzip' } }));
    vi.stubGlobal('fetch', fetchMock);
    await loadSnapshot(() => {});
    expect(cache.put).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/snapshot.msgpack.gz', { cache: 'no-cache' });
    // Cached bodies are decoded; retaining compressed length/encoding would corrupt progress.
    expect((await cache.match())?.headers.get('content-encoding')).toBeNull();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(await loadSnapshot(() => {})).toEqual(archive);
  });

  it('retains a valid compressed snapshot across offline reopening and corrupt deployments', async () => {
    const cache = storage();
    const bytes = gzipSync(encodeSnapshot(snapshotFixture()));
    const fetchMock = vi.fn().mockImplementation(async () => new Response(bytes));
    vi.stubGlobal('fetch', fetchMock);
    const first = await loadSnapshot(() => {});
    expect(cache.put).toHaveBeenCalledWith('/snapshot.msgpack.gz', expect.any(Response));
    expect(new Uint8Array(await (await cache.match())!.arrayBuffer())[0]).toBe(0x1f);
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    expect(await loadSnapshot(() => {})).toEqual(first);
    fetchMock.mockResolvedValueOnce(new Response(bytes.subarray(0, 20)));
    expect(await loadSnapshot(() => {})).toEqual(first);
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it('refreshes online but retains the last valid snapshot after an invalid deployment', async () => {
    const cache = storage();
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal('fetch', fetchMock);
    await loadSnapshot(() => {});
    const newer = { ...snapshot, generatedAt: '2026-10-04' };
    const newerArchive = decodeSnapshotArchive(gzipSync(encodeSnapshot(newer)));
    fetchMock.mockResolvedValue(new Response(gzipSync(encodeSnapshot(newer))));
    expect(await loadSnapshot(() => {})).toEqual(newerArchive);
    fetchMock.mockResolvedValue(new Response('<html>Sign in</html>'));
    expect(await loadSnapshot(() => {})).toEqual(newerArchive);
    expect(cache.put).toHaveBeenCalledTimes(2);
  });

  it('loads online when cache access or writes fail, and still fails offline with no valid cache', async () => {
    const cache = storage();
    cache.put.mockRejectedValue(new Error('quota exceeded'));
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadSnapshot(() => {})).toEqual(archive);
    vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('storage disabled')) });
    fetchMock.mockResolvedValue(response({}));
    expect(await loadSnapshot(() => {})).toEqual(archive);
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(loadSnapshot(() => {})).rejects.toThrow('offline');
  });
});
