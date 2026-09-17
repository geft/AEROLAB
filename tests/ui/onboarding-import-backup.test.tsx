// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OnboardingPage } from '../../src/frontend/components/OnboardingPage.js';
import { ProfileView } from '../../src/frontend/components/ProfileView.js';
import { LanguageProvider } from '../../src/frontend/i18n/LanguageContext.js';

describe('Onboarding & Profile Backup / Import UI Component Tests', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    // Mock fetch for profile and backup status endpoints
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
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

      if (urlStr.includes('/api/auth/google/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: {
              isConfigured: true,
              isConnected: false,
              email: null
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
              autoBackupEnabled: true,
              backupIntervalDays: 7,
              backupDirectory: 'data/backups',
              lastBackupAt: '2026-09-15T08:00:00Z'
            },
            recentBackups: []
          })
        });
      }

      if (urlStr.includes('/api/database/gdrive-backups')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ backups: [] })
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

      if (urlStr.includes('/api/ingest/upload')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: { status: 'imported', activityId: 'mock-upload-1' }
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
          headers: { 'Content-Type': 'application/json' }
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
      expect(screen.getByText(/Invalid or corrupt SQLite database file/i)).toBeTruthy();
    });

    expect(onCompleted).not.toHaveBeenCalled();
  });

  it('imports workout files in Onboarding and enables finishing setup', async () => {
    const onCompleted = vi.fn();
    render(
      <LanguageProvider>
        <OnboardingPage onCompleted={onCompleted} />
      </LanguageProvider>
    );

    // Switch to Import Workouts tab
    fireEvent.click(screen.getByText('Import Workouts'));

    expect(screen.getByText(/Import Workout Files/i)).toBeTruthy();

    const csvFile1 = new File(['Date,Time,Distance\n2026-09-10,08:00,5000'], 'workout1.csv', { type: 'text/csv' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    fireEvent.change(fileInput, { target: { files: [csvFile1] } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/ingest/upload',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });

    // Verifies success text and Proceed button
    await waitFor(() => {
      expect(screen.getByText(/Imported 1 workouts!/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /Proceed to Baseline Calibration/i })).toBeTruthy();
    });

    // Click proceed to calibration tab
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Baseline Calibration/i }));
    await waitFor(() => {
      expect(screen.getByText('Date of Birth')).toBeTruthy();
    });
  });

  it('triggers local database backup from ProfileView', async () => {
    render(
      <LanguageProvider>
        <ProfileView />
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Database Backup & Cloud Sync/i)).toBeTruthy();
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
