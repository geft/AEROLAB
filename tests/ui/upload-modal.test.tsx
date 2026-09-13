// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { UploadModal } from '../../src/frontend/components/UploadModal.js';

describe('UploadModal Multi-File UI Component Tests', () => {
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

    expect(screen.getByText('Import Garmin Run CSVs')).toBeTruthy();
    expect(screen.getByText(/drag & drop one or multiple csv files here/i)).toBeTruthy();
    expect(screen.getByText(/supports multi-file batch upload/i)).toBeTruthy();
    expect(screen.getByLabelText(/overwrite \/ re-calculate if activity was already imported/i)).toBeTruthy();
  });

  it('rejects non-CSV files and displays error message', async () => {
    render(
      <UploadModal
        isOpen={true}
        onClose={vi.fn()}
        onUploadSuccess={vi.fn()}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const badFile = new File(['dummy content'], 'run.fit', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [badFile] } });

    await waitFor(() => {
      expect(screen.getByText(/please upload \.csv file\(s\) exported from run-parser/i)).toBeTruthy();
    });
  });

  it('handles multi-file batch upload, displays summary counts, and closes on Done', async () => {
    const onClose = vi.fn();
    const onUploadSuccess = vi.fn();

    // Mock fetch responses for 2 files
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: 'imported', activityId: 'act-1' } })
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { status: 'skipped_duplicate', activityId: 'act-2' } })
      } as any);

    render(
      <UploadModal
        isOpen={true}
        onClose={onClose}
        onUploadSuccess={onUploadSuccess}
      />
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file1 = new File(['header\n1,2,3'], 'run1.csv', { type: 'text/csv' });
    const file2 = new File(['header\n4,5,6'], 'run2.csv', { type: 'text/csv' });

    fireEvent.change(input, { target: { files: [file1, file2] } });

    // Wait for batch summary to be rendered
    await waitFor(() => {
      expect(screen.getByText(/batch ingestion completed/i)).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it('displays detailed error breakdown in dialog when import fails and provides retry button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: 'UNIQUE constraint failed: activities.id',
        filename: 'failed_run.csv'
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
    const file = new File(['bad-content'], 'failed_run.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/batch ingestion failed/i)).toBeTruthy();
      expect(screen.getByText(/error details/i)).toBeTruthy();
      expect(screen.getByText(/failed_run\.csv/i)).toBeTruthy();
      expect(screen.getByText(/unique constraint failed: activities\.id/i)).toBeTruthy();
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
    const file = new File(['data'], 'force_test.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(sentPayload).not.toBeNull();
    });

    expect(sentPayload.force).toBe(true);
    expect(sentPayload.filename).toBe('force_test.csv');
  });

});
