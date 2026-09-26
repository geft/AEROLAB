// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadSessionCsv } from '../../src/frontend/utils/sessionCsv.js';
import type { Activity } from '../../src/frontend/types/api.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('downloadSessionCsv', () => {
  it('clicks a sanitized download link, removes it, and revokes its object URL', () => {
    const activity = { id: 'run / 42?', start_time: '2026-09-24T19:00:00' } as Activity;
    const createObjectURL = vi.fn(() => 'blob:session-export');
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const remove = vi.spyOn(HTMLAnchorElement.prototype, 'remove');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    downloadSessionCsv(activity, []);

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:session-export');
    expect(document.querySelector('a')).toBeNull();
    const link = click.mock.instances[0] as HTMLAnchorElement;
    expect(link.download).toBe('2026-09-24-run___42_.csv');
    expect(link.href).toBe('blob:session-export');
  });
});
