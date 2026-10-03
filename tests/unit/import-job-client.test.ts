import { afterEach, describe, expect, it, vi } from 'vitest';
import { importJobPercent, uploadImportJob } from '../../src/frontend/utils/import-job.js';
import * as api from '../../src/frontend/api/client.js';
import type { ImportJobStatus } from '../../src/shared/import-job.js';

vi.mock('../../src/frontend/api/client.js', () => ({
  startImportJob: vi.fn(), stageImportJob: vi.fn(), finishImportJob: vi.fn(), getImportJob: vi.fn(), cancelImportJob: vi.fn()
}));
const status = (phase: ImportJobStatus['phase'], results?: ImportJobStatus['results']): ImportJobStatus => ({
  jobId: 'job', phase, completed: 0, total: 2, uploaded: 0, totalFiles: 2, results
});
const file = (name: string, fail = false) => ({ name, size: 4, arrayBuffer: () => fail
  ? Promise.reject(new Error('unreadable')) : Promise.resolve(new TextEncoder().encode('data').buffer) }) as File;
function mockStart() {
  vi.mocked(api.startImportJob).mockResolvedValue(status('uploading'));
  vi.mocked(api.stageImportJob).mockResolvedValue(status('uploading'));
  vi.mocked(api.cancelImportJob).mockResolvedValue({ cancelled: true });
}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('whole-job upload client', () => {
  it('keeps overall progress increasing across phase counter resets and reserves 100% for completion', () => {
    const phases = ['uploading', 'decoding', 'importing', 'reanalysing'] as const;
    const percentages = phases.flatMap(phase => [0, 2].map(completed => importJobPercent({ ...status(phase), completed })));
    expect(percentages).toEqual([0, 20, 20, 45, 45, 70, 70, 99]);
    expect(importJobPercent(status('complete'))).toBe(100);
  });
  it('polls background progress and returns results in selected-file order', async () => {
    vi.useFakeTimers();
    mockStart();
    vi.mocked(api.finishImportJob).mockResolvedValue(status('decoding'));
    vi.mocked(api.getImportJob).mockResolvedValueOnce(status('reanalysing'))
      .mockResolvedValueOnce(status('complete', [{ status: 'imported', activityId: 'a' }, { status: 'error' }]));
    const progress = vi.fn();
    const pending = uploadImportJob([file('a.fit'), file('b.fit')], true, progress);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual([{ status: 'imported', activityId: 'a' }, { status: 'error' }]);
    expect(api.startImportJob).toHaveBeenCalledWith(2, true);
    expect(api.finishImportJob).toHaveBeenCalledWith('job', 2);
    expect(progress.mock.calls.map(call => call[0].phase)).toEqual(['uploading', 'decoding', 'reanalysing', 'complete']);
  });

  it('retains read failures in their original positions while importing readable files', async () => {
    mockStart();
    vi.mocked(api.finishImportJob).mockResolvedValue(status('complete', [{ status: 'imported' }]));
    expect(await uploadImportJob([file('bad.fit', true), file('good.fit')], false, vi.fn()))
      .toEqual([{ status: 'error' }, { status: 'imported' }]);
    expect(api.finishImportJob).toHaveBeenCalledWith('job', 1);
    expect(api.stageImportJob).toHaveBeenCalledWith('job', [{ filename: 'good.fit', content: btoa('data') }]);
  });

  it('cancels staged uploads if the next request fails, and does not start database writes', async () => {
    mockStart();
    vi.mocked(api.stageImportJob).mockRejectedValueOnce(new Error('upload failed'));
    await expect(uploadImportJob([file('a.fit')], false, vi.fn())).rejects.toThrow('upload failed');
    expect(api.cancelImportJob).toHaveBeenCalledWith('job');
    expect(api.finishImportJob).not.toHaveBeenCalled();
  });

  it('does not report success when the background transaction fails', async () => {
    mockStart();
    vi.mocked(api.finishImportJob).mockResolvedValue({ ...status('failed'), error: 'replay failed' });
    await expect(uploadImportJob([file('a.fit')], false, vi.fn())).rejects.toThrow('replay failed');
    expect(api.cancelImportJob).not.toHaveBeenCalled();
  });

  it('cancels without processing if none of the selected files can be read', async () => {
    mockStart();
    expect(await uploadImportJob([file('bad.fit', true)], false, vi.fn())).toEqual([{ status: 'error' }]);
    expect(api.cancelImportJob).toHaveBeenCalledWith('job');
    expect(api.finishImportJob).not.toHaveBeenCalled();
  });
});
