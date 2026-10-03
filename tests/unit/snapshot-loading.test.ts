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
