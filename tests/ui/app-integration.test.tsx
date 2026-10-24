// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { App, resolveSelectedActivityId } from '../../src/frontend/App.js';

describe('AEROLAB App Full Integration Tests', () => {
  const mockActivities = [
    {
      id: '24321232759',
      start_time: '2026-09-12 07:00:00',
      name: 'Singapore Running',
      run_type: 'easy_base',
      distance_meters: 8500,
      duration_seconds: 2800,
      avg_pace_sec_km: 330,
      avg_heart_rate: 138,
      max_heart_rate: 150,
      avg_cadence: 176,
      calories: 550,
      elevation_gain_m: 12,
      avg_temperature: 28,
      avg_vertical_oscillation: 82,
      avg_stance_time: 245,
      efficiency_factor: 1.25,
      aerobic_decoupling_pct: 2.1,
      meters_per_beat: 3.1,
      tags: JSON.stringify(['Easy Base'])
    }
  ];

  const mockDetail = {
    activity: {
      ...mockActivities[0],
      notes: 'Morning run'
    },
    splits: [],
    intervals: [],
    records: [],
    coachSummary: {
      headline: 'Near-Perfect Aerobic Base Execution',
      effectivenessScore: 95,
      keyInsights: ['Superb aerobic base'],
      recommendation: 'Good job'
    }
  };

  const mockThresholds = {
    latest: {
      lt1: {
        lt1_hr: 140,
        lt1_pace_sec_km: 330,
        baseline_economy_ef: 1.25,
        effective_date: '2026-09-12'
      },
      lt2: {
        lt2_hr: 165,
        lt2_pace_sec_km: 270,
        effective_date: '2026-09-12'
      },
      vo2Max: 58
    },
    currentThresholds: {
      lt1Hr: 140,
      lt2Hr: 165,
      lt1Range: [139, 141]
    },
    zones: {
      z1: [0, 126],
      z2: [127, 140],
      z3: [141, 164],
      z4: [165, 180],
      z5: [181, 203]
    },
    predictions: [],
    history: [],
    economyTrend: []
  };

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/thresholds')) {
        return {
          ok: true,
          json: async () => mockThresholds
        } as any;
      }
      if (urlStr.includes('/api/activities/volume')) {
        return {
          ok: true,
          json: async () => ({
            period: 'month',
            periodLabel: 'Past 30 Days',
            totalDistanceKm: 71.6,
            totalDurationHours: 8.2,
            activityCount: 5,
            elevationGainM: 135,
            avgEf: 1.16,
            zones: {
              z1: { hours: 0, pct: 0 },
              z2: { hours: 3.9, pct: 48 },
              z3: { hours: 2.1, pct: 26 },
              z4: { hours: 1.5, pct: 18 },
              z5: { hours: 0.7, pct: 8 }
            }
          })
        } as any;
      }
      if (urlStr.includes('/api/activities/progress-history')) {
        return {
          ok: true,
          json: async () => ({
            months: [{ period: '2026-09', label: 'Sep 2026' }],
            years: [{ period: '2026', label: '2026 Season' }]
          })
        } as any;
      }
      if (urlStr.includes('/api/activities/24321232759')) {
        return {
          ok: true,
          json: async () => mockDetail
        } as any;
      }
      if (urlStr.includes('/api/profile')) {
        return {
          ok: true,
          json: async () => ({
            isConfigured: true,
            profile: {
              id: 'primary',
              name: 'GJ',
              gender: 'Male',
              age: 37,
              resting_hr: 55,
              max_hr: 203,
              is_max_hr_estimated: 0,
              goal_marathon: 'Sub-4'
            },
            currentThresholds: {
              lt1Hr: 148,
              lt2Hr: 172,
              lt1PaceSecKm: 350,
              lt2PaceSecKm: 250
            }
          })
        } as any;
      }
      if (urlStr.includes('/api/activities')) {
        return {
          ok: true,
          json: async () => ({ activities: mockActivities })
        } as any;
      }
      return {
        ok: true,
        json: async () => ({})
      } as any;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('boots App, fetches activities, and renders main views via navbar tabs', async () => {
    render(<App />);

    // Wait for profile check to resolve and the main app shell to mount
    await waitFor(() => {
      expect(screen.getAllByText('AEROLAB').length).toBeGreaterThanOrEqual(1);
    });

    await waitFor(() => {
      expect(screen.getByText('Easy Aerobic Base')).toBeTruthy();
    });

    // Switch to Progress View
    const progressTab = document.getElementById('tab-progress-btn');
    expect(progressTab).toBeTruthy();
    fireEvent.click(progressTab!);

    await waitFor(() => {
      expect(screen.getByText(/Estimated LT1 Pace/i)).toBeTruthy();
      expect(screen.getByText(/Estimated LT2 Pace/i)).toBeTruthy();
    });

    // Switch to Stats View
    const statsTab = document.getElementById('tab-stats-btn');
    expect(statsTab).toBeTruthy();
    fireEvent.click(statsTab!);

    await waitFor(() => {
      // Physiological benchmark cards and HR training zones now live in Progress/Profile,
      // so the Stats tab renders the volume analytics card without duplicating them
      expect(screen.getByText('Training Volume')).toBeTruthy();
      expect(document.querySelector('.benchmarks-grid')).toBeNull();
      expect(document.querySelector('.zones-section')).toBeNull();
    });

    // Switch to Profile View
    const profileTab = document.getElementById('tab-profile-btn');
    expect(profileTab).toBeTruthy();
    fireEvent.click(profileTab!);

    await waitFor(() => {
      expect(screen.getByDisplayValue('55')).toBeTruthy();
      expect(screen.getByText(/Workout-Based Threshold Estimates/i)).toBeTruthy();
    });

    // Switch back to Browse View
    const browseTab = document.getElementById('tab-browse-btn');
    expect(browseTab).toBeTruthy();
    fireEvent.click(browseTab!);

    await waitFor(() => {
      expect(screen.getByText('Easy Aerobic Base')).toBeTruthy();
    });
  });

  it('shows a retryable history error instead of claiming the database is empty', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    const normalFetch = fetchMock.getMockImplementation()!;
    let historyUnavailable = true;
    fetchMock.mockImplementation(async (url, options) => {
      if (String(url) === '/api/activities' && historyUnavailable) {
        throw new TypeError('Backend unavailable');
      }
      return normalFetch(url, options);
    });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not load your run history'));
    expect(screen.queryByText('Ready for Your First Run')).toBeNull();
    historyUnavailable = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getByText('Easy Aerobic Base')).toBeTruthy());
  });

  it('shows a retryable error when the profile API is unreachable, without opening onboarding', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    const normalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, options) => {
      if (String(url).includes('/api/profile')) throw new TypeError('Backend unavailable');
      return normalFetch(url, options);
    });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Ready for Your First Run')).toBeNull();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('resets scroll position when switching main tabs', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('AEROLAB').length).toBeGreaterThanOrEqual(1));

    const scrollTo = vi.mocked(window.scrollTo);
    scrollTo.mockClear();
    fireEvent.click(document.getElementById('tab-progress-btn')!);

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    });
  });

  it('selects a valid run after a restore removes the previously selected run', () => {
    const restoredActivities = [{ ...mockActivities[0], id: 'restored-run-456' }];

    expect(resolveSelectedActivityId(restoredActivities, undefined, '24321232759')).toBe('restored-run-456');
    expect(resolveSelectedActivityId(restoredActivities, 'restored-run-456', '24321232759')).toBe('restored-run-456');
    expect(resolveSelectedActivityId([], undefined, '24321232759')).toBeNull();
  });

  it('persists Day Mode theme toggle to documentElement and localStorage', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Easy Aerobic Base')).toBeTruthy();
    });

    const themeBtn = await waitFor(() => {
      const btn = document.getElementById('theme-toggle-btn');
      expect(btn).toBeTruthy();
      return btn!;
    });

    // Default theme is dark
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('aerolab_theme')).toBe('dark');

    // Toggle to Light / Day Mode
    fireEvent.click(themeBtn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('aerolab_theme')).toBe('light');
    expect(themeBtn.textContent).toContain('Night Mode');

    // Toggle back to Dark / Night Mode
    fireEvent.click(themeBtn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('aerolab_theme')).toBe('dark');
    expect(themeBtn.textContent).toContain('Day Mode');
  });



  it('always gates on OnboardingPage when profile is unconfigured or empty', async () => {
    localStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            isConfigured: false,
            profile: {
              id: 'primary',
              name: 'Runner',
              resting_hr: null,
              dob: null,
              is_configured: 0
            }
          })
        } as any);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ activities: [] })
      } as any);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Running baselines/i)).toBeTruthy();
      expect(screen.getByText(/Set your baselines/i)).toBeTruthy();
    });
  });
});
