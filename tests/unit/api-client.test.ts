import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, getProfile, getTrainingLoad, patchActivity } from '../../src/frontend/api/client.js';
import { apiErrorMessage } from '../../src/frontend/api/errors.js';
import { en } from '../../src/frontend/i18n/en.js';

afterEach(() => vi.unstubAllGlobals());

describe('typed API client', () => {
  it('sends activity patches and returns the parsed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ activity: { id: 'run-1' }, coachSummary: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await patchActivity('run/1', { tags: ['Easy Base'] });
    expect(response.activity.id).toBe('run-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/activities/run%2F1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ tags: ['Easy Base'] })
    }));
  });

  it('maps a coded API error to dictionary copy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'ERR_INVALID_TAGS', error: 'server detail' }), { status: 400 })));
    await expect(patchActivity('run-1', { tags: ['bad'] })).rejects.toMatchObject({ status: 400, code: 'ERR_INVALID_TAGS' });
    expect(apiErrorMessage(en, new ApiRequestError(400, 'ERR_INVALID_TAGS', 'server detail'), en.apiErrors.generic))
      .toBe(en.apiErrors.invalidTags);
  });

  it('rejects malformed successful responses with a stable code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    await expect(getTrainingLoad()).rejects.toMatchObject({ code: 'ERR_INVALID_RESPONSE' });
  });

  it('distinguishes cancellation from a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')));
    await expect(getProfile()).rejects.toMatchObject({ name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(getProfile()).rejects.toMatchObject({ status: 0, code: 'ERR_NETWORK' });
  });
});
