import { beforeEach, describe, expect, it, vi } from 'vitest';

const snapshot = {
  schemaVersion: 1,
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
  it('serves a compatible read response from the exported JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = await import('../../src/frontend/api/snapshot-client.js');

    expect(await client.listActivities()).toEqual({ activities: snapshot.activities });
    expect((await client.getActivityDetail('run-1')).activity.id).toBe('run-1');
    expect(await client.getProgressHistory('easy_base')).toEqual(snapshot.progressByRunType.easy_base);
    expect(await client.getVolume({ period: 'month', month: '2026-09' })).toEqual(snapshot.volume['month:2026-09']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/snapshot.json', { cache: 'no-store' });
  });

  it('fails clearly for unsupported versions and missing sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...snapshot, schemaVersion: 99 }), { status: 200 })));
    const versionClient = await import('../../src/frontend/api/snapshot-client.js');
    await expect(versionClient.getProfile()).rejects.toMatchObject({ code: 'ERR_SNAPSHOT_VERSION' });

    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ schemaVersion: 1 }), { status: 200 })));
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
