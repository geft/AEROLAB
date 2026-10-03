// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UploadModal } from '../../src/frontend/components/UploadModal.js';
import * as importJob from '../../src/frontend/utils/import-job.js';
import type { ImportJobStatus } from '../../src/shared/import-job.js';

describe('UploadModal Multi-File UI Component Tests', () => {
  it('changes the phase label while keeping overall progress monotonic', async () => {
    let report!: (status: ImportJobStatus) => void;
    let finish!: (results: []) => void;
    vi.spyOn(importJob, 'uploadImportJob').mockImplementation((_files, _force, callback) => {
      report = callback;
      return new Promise(resolve => { finish = resolve; });
    });
    render(<UploadModal isOpen={true} onClose={vi.fn()} onUploadSuccess={vi.fn()} />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: {
      files: Array.from({ length: 9 }, (_, index) => new File(['data'], `run${index}.fit`))
    } });
    const update = (phase: ImportJobStatus['phase'], completed: number) => act(() => report({
      jobId: 'job', phase, completed, total: 9, uploaded: 9, totalFiles: 9
    }));
    update('uploading', 9);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('20');
    update('decoding', 0);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('20');
    expect(screen.getByRole('progressbar', { name: 'Reading activity files...' })).toBeTruthy();
    update('reanalysing', 9);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('99');
    update('reanalysing', 0);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('99');
    await act(async () => finish([]));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <UploadModal
        isOpen={false}
        onClose={vi.fn()}
        onUploadSuccess={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal header, drop zone, and overwrite toggle when open', () => {
    render(
      <UploadModal
        isOpen={true}
        onClose={vi.fn()}
        onUploadSuccess={vi.fn()}
      />
    );

    expect(screen.getByText(/Import Garmin Runs/i)).toBeTruthy();
    expect(screen.getByText(/drag & drop FIT or Garmin activity ZIP/i)).toBeTruthy();
    expect(screen.getByText(/supports multi-file batch upload/i)).toBeTruthy();
    expect(screen.getByLabelText(/overwrite \/ re-calculate if activity was already imported/i)).toBeTruthy();
  });

  it('rejects unsupported files and displays error message', async () => {
    render(
      <UploadModal
        isOpen={true}
        onClose={vi.fn()}
        onUploadSuccess={vi.fn()}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const badFile = new File(['dummy content'], 'run.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [badFile] } });

    await waitFor(() => {
      expect(screen.getByText(/please upload FIT or Garmin activity ZIP/i)).toBeTruthy();
    });
  });

  it('handles multi-file batch upload, displays summary counts, and closes on Done', async () => {
    const onClose = vi.fn();
    const onUploadSuccess = vi.fn();

    // Both files share one request and one historical replay.
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ status: 'imported', activityId: 'act-1' }, { status: 'skipped_duplicate', activityId: 'act-2' }] })
      } as any);

    render(
      <UploadModal
        isOpen={true}
        onClose={onClose}
        onUploadSuccess={onUploadSuccess}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file1 = new File(['header\n1,2,3'], 'run1.fit', { type: 'application/octet-stream' });
    const file2 = new File(['ZIP bytes'], 'run2.zip', { type: 'application/zip' });

    fireEvent.change(input, { target: { files: [file1, file2] } });

    // Wait for batch summary to be rendered
    await waitFor(() => {
      expect(screen.getByText(/batch ingestion completed/i)).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ingest/upload-batch');
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).files[1]).toMatchObject({ filename: 'run2.zip', content: btoa('ZIP bytes') });
    expect(onUploadSuccess).toHaveBeenCalledTimes(1);

    // Verify summary values
    expect(screen.getAllByText('1')).toHaveLength(2); // 1 imported, 1 skipped
    expect(screen.getByText('0')).toBeTruthy(); // 0 errors
    expect(screen.getByText(/imported/i)).toBeTruthy();
    expect(screen.getByText(/skipped \(dup\)/i)).toBeTruthy();

    const doneBtn = screen.getByRole('button', { name: /done/i });

    fireEvent.click(doneBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('rejects CSV exports without uploading them', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    render(<UploadModal isOpen={true} onClose={vi.fn()} onUploadSuccess={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('.fit,.FIT,.zip,.ZIP');
    fireEvent.change(input, { target: { files: [new File(['timestamp,heart_rate'], 'export.csv')] } });
    await waitFor(() => expect(screen.getByText(/please upload FIT or Garmin activity ZIP/i)).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('displays detailed error breakdown in dialog when import fails and provides retry button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: 'UNIQUE constraint failed: activities.id',
        filename: 'failed_run.fit'
      })
    } as any);

    render(
      <UploadModal
        isOpen={true}
        onClose={vi.fn()}
        onUploadSuccess={vi.fn()}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['bad-content'], 'failed_run.fit', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/batch ingestion failed/i)).toBeTruthy();
      expect(screen.getByText(/error details/i)).toBeTruthy();
      expect(screen.getByText(/failed_run\.fit/i)).toBeTruthy();
      expect(screen.getByText(/request could not be completed/i)).toBeTruthy();
      expect(screen.getByText(/retry with overwrite/i)).toBeTruthy();
    });

    // Clicking retry with overwrite should reset summary and enable overwrite checkbox
    const retryBtn = screen.getByRole('button', { name: /retry with overwrite/i });
    fireEvent.click(retryBtn);

    const checkbox = screen.getByLabelText(/overwrite \/ re-calculate/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('passes force: true when overwrite checkbox is checked', async () => {
    let sentPayload: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_url, options) => {
      sentPayload = JSON.parse(options?.body as string);
      return {
        ok: true,
        json: async () => ({ result: { status: 'imported', activityId: 'act-1' } })
      } as any;
    });

    render(
      <UploadModal
        isOpen={true}
        onClose={vi.fn()}
        onUploadSuccess={vi.fn()}
      />
    );

    const checkbox = screen.getByLabelText(/overwrite \/ re-calculate/i) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'force_test.fit', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(sentPayload).not.toBeNull();
    });

    expect(sentPayload.force).toBe(true);
    expect(sentPayload.filename).toBe('force_test.fit');
  });

  it('calls onUploadSuccess with activityId when importing a single file', async () => {
    const onUploadSuccess = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          status: 'imported',
          activityId: 'single-imported-run-123'
        }
      })
    } as any);

    render(
      <UploadModal
        isOpen={true}
        onClose={vi.fn()}
        onUploadSuccess={onUploadSuccess}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['csv-data'], 'single_run.fit', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onUploadSuccess).toHaveBeenCalledWith('single-imported-run-123');
    });
  });

  it('calls onUploadSuccess with activityId even if single file is already in database (duplicate)', async () => {
    const onUploadSuccess = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          status: 'skipped_duplicate',
          activityId: 'existing-run-456'
        }
      })
    } as any);

    render(
      <UploadModal
        isOpen={true}
        onClose={vi.fn()}
        onUploadSuccess={onUploadSuccess}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['csv-data'], 'duplicate_run.fit', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onUploadSuccess).toHaveBeenCalledWith('existing-run-456');
    });
  });

  it('calls onUploadSuccess with undefined when uploading multiple files in a batch', async () => {
    const onUploadSuccess = vi.fn();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ status: 'imported', activityId: 'batch-1' }, { status: 'imported', activityId: 'batch-2' }] })
      } as any);

    render(
      <UploadModal
        isOpen={true}
        onClose={vi.fn()}
        onUploadSuccess={onUploadSuccess}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file1 = new File(['csv-data1'], 'run1.fit', { type: 'application/octet-stream' });
    const file2 = new File(['csv-data2'], 'run2.fit', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [file1, file2] } });

    await waitFor(() => {
      expect(onUploadSuccess).toHaveBeenCalledWith(undefined);
    });
  });

  it('bounds batches, forwards overwrite, and keeps individual failures in the summary', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const payload = JSON.parse(options!.body as string);
      if (_url === '/api/ingest/jobs') return { ok: true, json: async () => ({ jobId: 'job-1', phase: 'uploading', completed: 0, total: 10 }) } as Response;
      if (String(_url).endsWith('/files')) return { ok: true, json: async () => ({ jobId: 'job-1', phase: 'uploading', completed: payload.files.length, total: 10 }) } as Response;
      return { ok: true, json: async () => ({ phase: 'complete', completed: 10, total: 10,
        results: Array.from({ length: 10 }, (_, index) => index === 8 ? { status: 'error' } : { status: 'imported' }) }) } as Response;
    });
    const onUploadSuccess = vi.fn();
    render(<UploadModal isOpen={true} onClose={vi.fn()} onUploadSuccess={onUploadSuccess} />);
    fireEvent.click(screen.getByLabelText(/overwrite \/ re-calculate/i));
    const files = Array.from({ length: 10 }, (_, index) => new File(['data'], `run${index}.fit`));
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });
    await waitFor(() => expect(screen.getByText(/error details/i)).toBeTruthy());
    expect(screen.getByText(/run8\.fit/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/files')).map(call => JSON.parse(call[1]!.body as string).files.length)).toEqual([8, 2]);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).force).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[3][1]!.body as string).totalFiles).toBe(10);
    expect(onUploadSuccess).toHaveBeenCalledTimes(1);
    expect(screen.getByText('9')).toBeTruthy();
  });

  it('continues with readable files when one file cannot be read', async () => {
    const broken = new File(['data'], 'unreadable.fit');
    broken.arrayBuffer = () => Promise.reject(new Error('Read failed'));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true,
      json: async () => ({ results: [{ status: 'imported' }] }) } as Response);
    render(<UploadModal isOpen={true} onClose={vi.fn()} onUploadSuccess={vi.fn()} />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [broken, new File(['good'], 'good.fit')] } });
    await waitFor(() => expect(screen.getByText(/error details/i)).toBeTruthy());
    expect(screen.getByText(/unreadable\.fit/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).files.map((file: { filename: string }) => file.filename)).toEqual(['good.fit']);
  });

  it('splits large files across requests to stay under the batch byte budget', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true,
      json: async () => ({ results: [{ status: 'imported' }] }) } as Response);
    const onUploadSuccess = vi.fn();
    render(<UploadModal isOpen={true} onClose={vi.fn()} onUploadSuccess={onUploadSuccess} />);
    const files = ['large1.fit', 'large2.fit'].map(name => {
      const file = new File(['data'], name);
      Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 });
      return file;
    });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });
    await waitFor(() => expect(onUploadSuccess).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map(call => JSON.parse(call[1]!.body as string).files.length)).toEqual([1, 1]);
  });

  it('starts reading the next file before the first file finishes', async () => {
    const first = new File(['first'], 'first.fit');
    const second = new File(['second'], 'second.fit');
    let finishFirst!: (buffer: ArrayBuffer) => void;
    first.arrayBuffer = vi.fn(() => new Promise<ArrayBuffer>(resolve => { finishFirst = resolve; }));
    const secondRead = vi.spyOn(second, 'arrayBuffer');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true,
      json: async () => ({ results: [{ status: 'imported' }, { status: 'imported' }] }) } as Response);
    const onUploadSuccess = vi.fn();
    render(<UploadModal isOpen={true} onClose={vi.fn()} onUploadSuccess={onUploadSuccess} />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [first, second] } });
    expect(secondRead).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    finishFirst(new TextEncoder().encode('first').buffer);
    await waitFor(() => expect(onUploadSuccess).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
