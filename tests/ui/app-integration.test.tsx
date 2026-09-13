// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { App } from '../../src/frontend/App.js';

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
      lt1_hr: 140,
      lt1_pace_sec_km: 330,
      lt2_hr: 165,
      lt2_pace_sec_km: 270,
      baseline_economy_ef: 1.25,
      effective_date: '2026-09-12'
    },
    history: [],
    economyTrend: []
  };

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/thresholds')) {
        return {
          ok: true,
          json: async () => mockThresholds
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

    // Check header brand and initial browse view
    expect(screen.getAllByText('AEROLAB').length).toBeGreaterThanOrEqual(1);

    await waitFor(() => {

      expect(screen.getByText('Easy Aerobic Base')).toBeTruthy();
    });

    // Switch to Progress View
    const progressTab = document.getElementById('tab-progress-btn');
    expect(progressTab).toBeTruthy();
    fireEvent.click(progressTab!);

    await waitFor(() => {
      expect(screen.getByText(/aerobic threshold \(lt1\) pace/i)).toBeTruthy();
      expect(screen.getByText(/lactate threshold \(lt2\) pace/i)).toBeTruthy();
    });

    // Switch to Stats View
    const statsTab = document.getElementById('tab-stats-btn');
    expect(statsTab).toBeTruthy();
    fireEvent.click(statsTab!);

    await waitFor(() => {
      expect(screen.getByText(/aerobic base \(lt1\)/i)).toBeTruthy();
      expect(screen.getByText(/lactate threshold \(lt2\)/i)).toBeTruthy();
    });

    // Switch to Profile View
    const profileTab = document.getElementById('tab-profile-btn');
    expect(profileTab).toBeTruthy();
    fireEvent.click(profileTab!);

    await waitFor(() => {
      expect(screen.getByText(/Cardio Baselines & Resting HR/i)).toBeTruthy();
      expect(screen.getByText(/Inferred Physiological Thresholds/i)).toBeTruthy();
    });

    // Switch back to Browse View
    const browseTab = document.getElementById('tab-browse-btn');
    expect(browseTab).toBeTruthy();
    fireEvent.click(browseTab!);

    await waitFor(() => {
      expect(screen.getByText('Easy Aerobic Base')).toBeTruthy();
    });
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

  it('opens and closes the multi-file Upload CSV modal from navbar', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Easy Aerobic Base')).toBeTruthy();
    });

    const uploadBtn = document.getElementById('nav-upload-btn');
    expect(uploadBtn).toBeTruthy();

    fireEvent.click(uploadBtn!);

    await waitFor(() => {
      expect(screen.getByText(/Import Garmin Runs/i)).toBeTruthy();
    });

    const closeBtn = document.querySelector('.modal-close-btn');
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);

    await waitFor(() => {
      expect(screen.queryByText('Import Garmin Run CSVs')).toBeNull();
    });
  });
});
