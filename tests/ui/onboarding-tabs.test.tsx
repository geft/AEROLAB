// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OnboardingPage } from '../../src/frontend/components/OnboardingPage.js';
import { LanguageProvider } from '../../src/frontend/i18n/LanguageContext.js';

describe('Onboarding Tabs & Restore Flow UI Tests', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ isConfigured: false, profile: null })
        });
      }
      if (url.includes('/api/auth/google/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: { isConfigured: true, isConnected: false } })
        });
      }
      if (url.includes('/api/database/gdrive-backups')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ backups: [] })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({})
      });
    });
  });

  it('renders all 3 onboarding mode tabs and switches between them', async () => {
    const onCompleted = vi.fn();
    render(
      <LanguageProvider>
        <OnboardingPage onCompleted={onCompleted} />
      </LanguageProvider>
    );

    // Initial setup tab
    expect(screen.getByText('New Athlete Setup')).toBeTruthy();
    expect(screen.getByText('Restore Backup (.db)')).toBeTruthy();
    expect(screen.getByText('Import Workouts')).toBeTruthy();
    expect(screen.getByText('Date of Birth')).toBeTruthy();

    // Click Restore Backup tab
    fireEvent.click(screen.getByText('Restore Backup (.db)'));
    await waitFor(() => {
      expect(screen.getByText(/Restore from Database Snapshot/i)).toBeTruthy();
    });
    expect(screen.getByText(/Restore from Google Drive/i)).toBeTruthy();
    expect(screen.getAllByText(/Sign in with Google/i).length).toBeGreaterThan(0);

    // Click Import Workouts tab
    fireEvent.click(screen.getByText('Import Workouts'));
    await waitFor(() => {
      expect(screen.getByText(/Import Workout Files/i)).toBeTruthy();
      expect(screen.getByText(/Drop Garmin CSV or \.fit activity files/i)).toBeTruthy();
    });
  });
});
