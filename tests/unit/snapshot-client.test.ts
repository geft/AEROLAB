import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { encodeSnapshot } from '../../src/shared/snapshot-codec.js';
import { snapshotFixture } from '../fixtures/snapshot.js';
import { encode } from '@msgpack/msgpack';

const snapshot = {
  schemaVersion: 2,
  generatedAt: '2026-09-26T00:00:00.000Z',
  activities: [{ id: 'run-1', start_time: '2026-09-01T07:00:00Z' }],
  details: { 'run-1': { activity: { id: 'run-1' }, splits: [], intervals: [], records: [], coachSummary: null, heartRateThresholds: { lt1Hr: null, lt2Hr: null }, pauseBreakdown: {} } },
  profile: { profile: { id: 'primary' }, isConfigured: true },
  bestEfforts: { allTime: [], currentYear: [], targets: [] },
  progressByRunType: { all: { months: [], years: [] }, easy_base: { months: [], years: [] } },
  thresholdsByRunType: { all: { latest: {}, currentThresholds: {}, zones: {}, predictions: [], history: [], economyTrend: [], scatterData: [] } },
  volume: { 'month:2026-09': { period: 'month' }, 'month:current': { period: 'month' } },
  trainingLoadByDays: { '30': { trainingStatus: {} } }
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('snapshot API client', () => {
  it('serves normalized activity details from a compressed binary snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(gzipSync(encodeSnapshot(snapshotFixture())))));
    const client = await import('../../src/frontend/api/snapshot-client.js');
    expect((await client.listActivities()).activities).toEqual(snapshotFixture().activities);
    const detail = await client.getActivityDetail('run-1');
    expect(detail.activity.name).toBe('Detailed run');
    expect(detail.records[1].speed_mps).toBe(3.1234567891011);
    expect(detail.records[1].cadence).toBeNull();
    expect(await client.getSnapshotMetadata()).toEqual({ generatedAt: snapshotFixture().generatedAt });
  });
  it('loads once in a worker and requests sections without copying the entire snapshot to the UI', async () => {
    const messages: unknown[] = [];
    class SnapshotWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror = null;
      onmessageerror = null;
      terminate = vi.fn();
      postMessage(message: { type: string; id: number; section: keyof typeof snapshot; key?: string }) {
        messages.push(message);
        queueMicrotask(() => {
          if (message.type === 'load') {
            this.onmessage?.({ data: { type: 'progress', progress: { stage: 'downloading', percent: 42 } } });
            this.onmessage?.({ data: { type: 'progress', progress: { stage: 'preparing' } } });
            this.onmessage?.({ data: { type: 'ready' } });
          } else {
            const section = snapshot[message.section];
            this.onmessage?.({ data: { type: 'value', id: message.id, value: message.key === undefined ? section : (section as Record<string, unknown>)[message.key] } });
          }
        });
      }
    }
    vi.stubGlobal('Worker', SnapshotWorker);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('../../src/frontend/api/snapshot-client.js');
    const progress: string[] = [];
    const unsubscribe = client.subscribeSnapshotLoading(() => progress.push(client.getSnapshotLoadingProgress().stage));
    expect(await client.listActivities()).toEqual({ activities: snapshot.activities });
    expect(await client.getSnapshotMetadata()).toEqual({ generatedAt: snapshot.generatedAt });
    expect(await client.getActivityDetail('run-1')).toEqual(snapshot.details['run-1']);
    expect(progress).toEqual(['downloading', 'preparing', 'ready']);
    expect(messages).toEqual([
      { type: 'load' },
      { type: 'read', id: 1, section: 'activities' },
      { type: 'read', id: 2, section: 'generatedAt' },
      { type: 'read', id: 3, section: 'details', key: 'run-1' }
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('serves compatible section responses from exported MessagePack', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(gzipSync(encodeSnapshot(snapshot)), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('../../src/frontend/api/snapshot-client.js');

    expect(await client.listActivities()).toEqual({ activities: snapshot.activities });
    expect((await client.getActivityDetail('run-1')).activity.id).toBe('run-1');
    expect(await client.getProgressHistory('easy_base')).toEqual(snapshot.progressByRunType.easy_base);
    expect(await client.getVolume({ period: 'month', month: '2026-09' })).toEqual(snapshot.volume['month:2026-09']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/snapshot.msgpack.gz', { cache: 'no-cache' });
  });

  it('fails clearly for unsupported versions and missing sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(encode({ ...snapshot, schemaVersion: 99 }), { status: 200 })));
    const versionClient = await import('../../src/frontend/api/snapshot-client.js');
    await expect(versionClient.getProfile()).rejects.toMatchObject({ code: 'ERR_SNAPSHOT_VERSION' });

    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(encode({ schemaVersion: 2 }), { status: 200 })));
    const missingClient = await import('../../src/frontend/api/snapshot-client.js');
    await expect(missingClient.getProfile()).rejects.toMatchObject({ code: 'ERR_SNAPSHOT_INVALID' });
  });

  it('has no working write API and never sends a mutation request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('../../src/frontend/api/snapshot-client.js');
    expect(() => client.patchActivity('run-1', { name: 'Changed' })).toThrowError('This snapshot is read-only.');
    expect(() => client.updateProfile({})).toThrowError('This snapshot is read-only.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
