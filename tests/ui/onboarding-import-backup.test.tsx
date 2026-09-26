// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OnboardingPage } from '../../src/frontend/components/OnboardingPage.js';
import { BackupModal } from '../../src/frontend/components/BackupModal.js';
import { LanguageProvider } from '../../src/frontend/i18n/LanguageContext.js';

describe('Onboarding & Profile Backup / Import UI Component Tests', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    // Mock fetch for profile and backup status endpoints
    global.fetch = vi.fn().mockImplementation((url: string, _opts?: any) => {
      const urlStr = String(url);

      if (urlStr.includes('/api/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            isConfigured: false,
            profile: {
              name: 'GJ',
              restingHr: 55,
              maxHr: 203,
              lt1Hr: 148,
              lt2Hr: 167
            }
          })
        });
      }

      if (urlStr.includes('/api/database/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            dbPath: 'data/runs.db',
            sizeBytes: 1048576,
            activityCount: 24,
            settings: {
              backupDirectory: 'data/backups',
            },
            recentBackups: []
          })
        });
      }

      if (urlStr.includes('/api/database/restore')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'ok', activityCount: 18 })
        });
      }

      if (urlStr.includes('/api/database/backup')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'ok',
            backup: { filename: 'runs-backup-2026-09-17.db', sizeBytes: 1048576 }
          })
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({})
      });
    });
  });

  it('restores database snapshot from .db file drop in Onboarding and finishes setup', async () => {
    const onCompleted = vi.fn();
    render(
      <LanguageProvider>
        <OnboardingPage onCompleted={onCompleted} />
      </LanguageProvider>
    );

    // Switch to Restore Backup tab
    const restoreTabBtn = screen.getByText('Restore Backup (.db)');
    fireEvent.click(restoreTabBtn);

    expect(screen.getByText(/Restore from Database Snapshot/i)).toBeTruthy();

    // Select a .db file
    const file = new File(['SQLite format 3\0mock-db'], 'my-backup.db', { type: 'application/x-sqlite3' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    fireEvent.change(fileInput, { target: { files: [file] } });

    // Verifies fetch was called with /api/database/restore
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/database/restore',
        expect.objectContaining({
          method: 'POST',
          // Raw binary body: the server streams it to disk, so the snapshot size is
          // no longer limited by the JSON body parser.
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file
        })
      );
    });

    // Verifies onCompleted is called
    await waitFor(() => {
      expect(onCompleted).toHaveBeenCalled();
    }, { timeout: 2500 });
  });

  it('displays error banner if database restore fails in Onboarding', async () => {
    // Override fetch to return 422 error
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/database/restore')) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: async () => ({ error: 'Invalid or corrupt SQLite database file' })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ isConfigured: false, status: { isConfigured: false } })
      });
    });

    const onCompleted = vi.fn();
    render(
      <LanguageProvider>
        <OnboardingPage onCompleted={onCompleted} />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByText('Restore Backup (.db)'));

    const file = new File(['bad data'], 'corrupt.db', { type: 'application/x-sqlite3' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/request could not be completed/i)).toBeTruthy();
    });

    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('never pre-fills placeholder profile values and keeps setup blocked until completed', async () => {
    // A schema placeholder row (is_configured = 0) must not populate the form.
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/api/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            isConfigured: false,
            profile: {
              id: 'primary',
              gender: 'Prefer not to say',
              dob: '1989-04-15',
              resting_hr: 55,
              is_configured: 0
            }
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(
      <LanguageProvider>
        <OnboardingPage onCompleted={vi.fn()} />
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/profile');
    });

    const dobInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    const rhrInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    const genderSelect = document.querySelector('select') as HTMLSelectElement;
    const submitBtn = screen.getByRole('button', { name: /Save & Launch AEROLAB/i }) as HTMLButtonElement;

    expect(dobInput.value).toBe('');
    expect(rhrInput.value).toBe('');
    expect(genderSelect.value).toBe('');
    expect(submitBtn.disabled).toBe(true);
  });

  it('triggers local database backup from BackupModal', async () => {
    render(
      <LanguageProvider>
        <BackupModal isOpen={true} onClose={vi.fn()} />
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Database Backup & Snapshots/i)).toBeTruthy();
    });

    // Find and click Backup Now to Folder button
    const backupBtn = screen.getByRole('button', { name: /Backup Now to Folder/i });
    expect(backupBtn).toBeTruthy();

    fireEvent.click(backupBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/database/backup',
        expect.objectContaining({
          method: 'POST'
        })
      );
    });
  });
});
