import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSnapshot } from '../../src/frontend/api/snapshot-loading.js';
import type { SnapshotLoadingProgress } from '../../src/frontend/api/snapshot-loading.js';

afterEach(() => vi.unstubAllGlobals());
const snapshot = { schemaVersion: 1, generatedAt: '2026-10-03', activities: [], details: {}, profile: { name: '跑者' } };

function response(headers: HeadersInit): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const split = bytes.findIndex(byte => byte > 127) + 1;
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(bytes.slice(0, split)); controller.enqueue(bytes.slice(split)); controller.close(); }
  }), { headers });
}

describe('snapshot streaming progress', () => {
  it('reports real download percentages and preserves UTF-8 split across chunks', async () => {
    const size = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ 'Content-Length': String(size) })));
    const progress: SnapshotLoadingProgress[] = [];
    expect(await loadSnapshot(value => progress.push(value))).toEqual(snapshot);
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

  it('rejects network, malformed JSON and incompatible snapshots', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(loadSnapshot(() => {})).rejects.toMatchObject({ code: 'ERR_SNAPSHOT_MISSING' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad JSON')));
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
    const fetchMock = vi.fn().mockResolvedValue(response({ 'Content-Encoding': 'gzip' }));
    vi.stubGlobal('fetch', fetchMock);
    await loadSnapshot(() => {});
    expect(cache.put).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/snapshot.json', { cache: 'no-cache' });
    // Cached bodies are decoded; retaining compressed length/encoding would corrupt progress.
    expect((await cache.match())?.headers.get('content-encoding')).toBeNull();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(await loadSnapshot(() => {})).toEqual(snapshot);
  });

  it('refreshes online but retains the last valid snapshot after an invalid deployment', async () => {
    const cache = storage();
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal('fetch', fetchMock);
    await loadSnapshot(() => {});
    const newer = { ...snapshot, generatedAt: '2026-10-04' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(newer)));
    expect(await loadSnapshot(() => {})).toEqual(newer);
    fetchMock.mockResolvedValue(new Response('<html>Sign in</html>'));
    expect(await loadSnapshot(() => {})).toEqual(newer);
    expect(cache.put).toHaveBeenCalledTimes(2);
  });

  it('loads online when cache access or writes fail, and still fails offline with no valid cache', async () => {
    const cache = storage();
    cache.put.mockRejectedValue(new Error('quota exceeded'));
    const fetchMock = vi.fn().mockResolvedValue(response({}));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadSnapshot(() => {})).toEqual(snapshot);
    vi.stubGlobal('caches', { open: vi.fn().mockRejectedValue(new Error('storage disabled')) });
    fetchMock.mockResolvedValue(response({}));
    expect(await loadSnapshot(() => {})).toEqual(snapshot);
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(loadSnapshot(() => {})).rejects.toThrow('offline');
  });
});
