// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SettingsView } from '../../src/frontend/components/SettingsView.js';
import { Navbar } from '../../src/frontend/components/Navbar.js';
import { ProfileView } from '../../src/frontend/components/ProfileView.js';
import { LanguageProvider } from '../../src/frontend/i18n/LanguageContext.js';
import { FontSizeProvider } from '../../src/frontend/context/FontSizeContext.js';

describe('SettingsView & Header Tab Navigation Tests', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders Settings tab in Navbar next to Profile and triggers onTabChange', () => {
    const onTabChange = vi.fn();

    render(
      <LanguageProvider>
        <FontSizeProvider>
          <Navbar
            activeTab="browse"
            onTabChange={onTabChange}
            onOpenUpload={vi.fn()}
            theme="dark"
            onToggleTheme={vi.fn()}
          />
        </FontSizeProvider>
      </LanguageProvider>
    );

    const profileBtn = document.getElementById('tab-profile-btn');
    const settingsBtn = document.getElementById('tab-settings-btn');

    expect(profileBtn).toBeTruthy();
    expect(settingsBtn).toBeTruthy();
    expect(settingsBtn?.textContent).toContain('Settings');

    // Click settings button
    fireEvent.click(settingsBtn!);
    expect(onTabChange).toHaveBeenCalledWith('settings');
  });

  it('renders SettingsView with Backup & Cloud Sync, Display, and Diagnostics sections', async () => {
    // Mock database and google status endpoints
    vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
      if (typeof url === 'string' && url.includes('/api/database/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            sizeMb: '12.4',
            activityCount: 329,
            snapshots: [
              { filename: 'runs-2026-09-19.db', createdAt: new Date().toISOString(), sizeMb: '12.4' }
            ]
          })
        } as any);
      }
      if (typeof url === 'string' && url.includes('/api/auth/google/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            status: { isConnected: false }
          })
        } as any);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as any);
    });

    const onToggleTheme = vi.fn();
    const onOpenDevDiagnostics = vi.fn();

    render(
      <LanguageProvider>
        <FontSizeProvider>
          <SettingsView
            theme="dark"
            onToggleTheme={onToggleTheme}
            onOpenDevDiagnostics={onOpenDevDiagnostics}
          />
        </FontSizeProvider>
      </LanguageProvider>
    );

    // The redundant in-page header was removed; the Navbar tab already labels this page
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();

    // Verify sections
    expect(screen.getByText(/Database Backup & Cloud Sync/i)).toBeTruthy();
    expect(screen.getByText(/Display & Appearance/i)).toBeTruthy();
    expect(screen.getByText(/Developer Diagnostics/i)).toBeTruthy();

    // Verify theme toggle in settings
    const themeBtn = document.getElementById('settings-theme-toggle-btn');
    expect(themeBtn).toBeTruthy();
    fireEvent.click(themeBtn!);
    expect(onToggleTheme).toHaveBeenCalled();

    // Verify dev diagnostics trigger
    const devBtn = document.getElementById('settings-open-dev-btn');
    expect(devBtn).toBeTruthy();
    fireEvent.click(devBtn!);
    expect(onOpenDevDiagnostics).toHaveBeenCalled();
  });

  it('navigates from ProfileView backup card to Settings tab', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          profile: { id: 'primary', resting_hr: 54, max_hr: 185 },
          currentThresholds: { lt1Hr: 145, lt2Hr: 172 }
        })
      } as any);
    });

    const onNavigateToSettings = vi.fn();

    render(
      <LanguageProvider>
        <ProfileView onNavigateToSettings={onNavigateToSettings} />
      </LanguageProvider>
    );

    await waitFor(() => {
      const openSettingsBtn = document.getElementById('profile-open-backup-btn');
      expect(openSettingsBtn).toBeTruthy();
      expect(openSettingsBtn?.textContent).toContain('Settings');
      fireEvent.click(openSettingsBtn!);
      expect(onNavigateToSettings).toHaveBeenCalled();
    });
  });

  it('renders split-screen consolidated more menu trigger and opens actions menu', () => {
    const onToggleTheme = vi.fn();

    render(
      <LanguageProvider>
        <FontSizeProvider>
          <Navbar
            activeTab="browse"
            onTabChange={vi.fn()}
            onOpenUpload={vi.fn()}
            theme="dark"
            onToggleTheme={onToggleTheme}
          />
        </FontSizeProvider>
      </LanguageProvider>
    );

    const moreBtn = document.getElementById('nav-more-menu-btn');
    expect(moreBtn).toBeTruthy();

    // Click more menu button to toggle dropdown
    fireEvent.click(moreBtn!);
    expect(screen.getByText(/Appearance & Display/i)).toBeTruthy();

    const moreThemeBtn = document.getElementById('more-menu-theme-btn');
    expect(moreThemeBtn).toBeTruthy();
    fireEvent.click(moreThemeBtn!);
    expect(onToggleTheme).toHaveBeenCalled();
  });

  it('renders and toggles floating dev mode button setting', () => {
    const onToggleDevFloatingBtn = vi.fn();

    const { rerender } = render(
      <LanguageProvider>
        <FontSizeProvider>
          <SettingsView
            theme="dark"
            onToggleTheme={vi.fn()}
            showDevFloatingBtn={false}
            onToggleDevFloatingBtn={onToggleDevFloatingBtn}
          />
        </FontSizeProvider>
      </LanguageProvider>
    );

    const toggleInput = document.getElementById('settings-toggle-dev-btn') as HTMLInputElement;
    expect(toggleInput).toBeTruthy();
    expect(toggleInput.checked).toBe(false);

    fireEvent.click(toggleInput);
    expect(onToggleDevFloatingBtn).toHaveBeenCalledWith(true);

    // Re-render enabled
    rerender(
      <LanguageProvider>
        <FontSizeProvider>
          <SettingsView
            theme="dark"
            onToggleTheme={vi.fn()}
            showDevFloatingBtn={true}
            onToggleDevFloatingBtn={onToggleDevFloatingBtn}
          />
        </FontSizeProvider>
      </LanguageProvider>
    );

    expect(toggleInput.checked).toBe(true);
  });
});
