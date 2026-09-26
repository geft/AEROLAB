// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { StatsView } from '../../src/frontend/components/StatsView.js';

describe('StatsView UI Tests', () => {
  const mockThresholdData = {
    latest: {
      lt1: { lt1_hr: 148, lt1_pace_sec_km: 352, effective_date: '2026-09-05', baseline_economy_ef: 1.19 },
      lt2: { lt2_hr: 171, lt2_pace_sec_km: 280, effective_date: '2026-09-10' },
      vo2Max: 58
    },
    currentThresholds: {
      lt1Hr: 148,
      lt2Hr: 171,
      lt1Range: [147, 149]
    },
    zones: {
      z1: [0, 134],
      z2: [135, 148],
      z3: [149, 166],
      z4: [167, 188],
      z5: [189, 203]
    },
    history: [],
    predictions: [{ distanceName: '5K', timeSeconds: 1305, timeFormatted: '21:45', paceFormatted: '4:21/km' }]
  };

  const mockProgressHistory = {
    months: [
      { period: '2026-01', label: 'Jan 2026' },
      { period: '2026-04', label: 'Apr 2026' },
      { period: '2026-09', label: 'Sep 2026' }
    ],
    years: [
      { period: '2026', label: '2026 Season' }
    ]
  };

  const mockVolumeMonth = {
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
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/thresholds')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockThresholdData)
          });
        }
        if (url.includes('/api/activities/progress-history')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockProgressHistory)
          });
        }
        if (url.includes('/api/activities/volume')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockVolumeMonth)
          });
        }
        if (url.includes('/api/profile')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ profile: { age: 40, gender: 'Male' } }) });
        }
        return Promise.reject(new Error(`Unhandled fetch url: ${url}`));
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders volume analytics with period tabs, KPI boxes, and zone visual bar', async () => {
    const { container } = render(<StatsView />);

    await waitFor(() => {
      expect(screen.getByText('Training Volume & Effort Analytics')).toBeDefined();
      expect(screen.getByText('Past 7 Days')).toBeDefined();
      expect(screen.getByText('Monthly')).toBeDefined();
      expect(screen.getByText('This Year')).toBeDefined();
      expect(screen.getByText('All-Time')).toBeDefined();
    });

    // Verify KPI grid & styled boxes exist
    const kpiGrid = container.querySelector('.volume-kpis-grid');
    expect(kpiGrid).toBeTruthy();
    const kpiBoxes = container.querySelectorAll('.volume-kpi-box');
    expect(kpiBoxes.length).toBe(4);
    expect(container.querySelector('.volume-kpi-box.highlight')).toBeTruthy();

    // Verify Zone Visual Bar exists and has 5 segments
    const zoneBar = container.querySelector('.zone-visual-bar');
    expect(zoneBar).toBeTruthy();
    const barSegments = zoneBar!.querySelectorAll('.zone-bar-segment');
    expect(barSegments.length).toBe(5);

    // Benchmark cards & HR training zones were removed from Stats — they live in
    // Progress and Profile to avoid duplicating the same numbers twice.
    expect(container.querySelector('.benchmarks-grid')).toBeNull();
    expect(container.querySelector('.zones-section')).toBeNull();
    expect(container.querySelector('.zones-grid')).toBeNull();
    const timeKpi = container.querySelectorAll('.volume-kpi-box')[1];
    expect(timeKpi?.textContent).toContain('Running Economy (EF): 1.16 EF');
    expect(timeKpi?.textContent).not.toContain('m/beat');

    // Verify month dropdown is present when Monthly tab is active
    await waitFor(() => {
      const select = screen.getByTitle('Select specific month to analyze') as HTMLSelectElement;
      expect(select).toBeDefined();
      expect(select.options.length).toBeGreaterThanOrEqual(4); // "All / Recent" + 3 months
    });
  });

  it('changes period when a different month is selected from the dropdown', async () => {
    render(<StatsView />);

    await waitFor(() => {
      expect(screen.getByTitle('Select specific month to analyze')).toBeDefined();
    });

    const select = screen.getByTitle('Select specific month to analyze');
    fireEvent.change(select, { target: { value: '2026-09' } });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/activities/volume?period=month&month=2026-09');
    });
  });

  it('switches volume periods (Past 7 Days, This Year, All-Time)', async () => {
    render(<StatsView />);

    await waitFor(() => {
      expect(screen.getByText('Past 7 Days')).toBeDefined();
    });

    // Click Past 7 Days
    fireEvent.click(screen.getByText('Past 7 Days'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/activities/volume?period=week');
    });

    // Click This Year
    fireEvent.click(screen.getByText('This Year'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/activities/volume?period=year');
    });

    // Click All-Time
    fireEvent.click(screen.getByText('All-Time'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/activities/volume?period=all');
    });
  });

  it('opens and closes Aerobic Turnpoint Margin Guide Modal when info (?) button is clicked', async () => {
    render(<StatsView />);

    await waitFor(() => {
      expect(screen.getByText('Aerobic Turnpoint Margin')).toBeDefined();
    });

    const infoBtn = screen.getByLabelText('Aerobic Turnpoint Margin Guide');
    expect(infoBtn).toBeDefined();
    fireEvent.click(infoBtn);

    // Modal is rendered
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Aerobic Turnpoint Margin Guide' })).toBeDefined();
      expect(screen.getByText(/What is the Aerobic Turnpoint Margin\?/i)).toBeDefined();
      expect(screen.getByText(/Target Benchmarks & Standards/i)).toBeDefined();
      expect(screen.getByText(/35–50s\/km Gap/i)).toBeDefined();
      expect(screen.getByText(/50–70s\/km Gap/i)).toBeDefined();
    });

    // Close modal via Got It button
    const closeBtn = screen.getByRole('button', { name: 'Got It' });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Aerobic Turnpoint Margin Guide')).toBeNull();
    });
  });

  it('opens a compact demographic benchmark popup on hover', async () => {
    render(<StatsView />);
    const button = await screen.findByRole('button', { name: 'Compare 5K with peers' });
    fireEvent.mouseEnter(button);
    await waitFor(() => {
      expect(screen.getByText('Male · age 40')).toBeDefined();
      expect(screen.getByText(/Estimated race time: 21:45 · Intermediate tier/)).toBeDefined();
      expect(screen.getByText(/50–80% of peers would be slower/)).toBeDefined();
      expect(screen.getByText('Approximate race time ranges by tier:')).toBeDefined();
      expect(screen.getByText(/benchmarks add no weather adjustment/i)).toBeDefined();
    });
    fireEvent.mouseLeave(button);
    await waitFor(() => expect(screen.queryByText('Male · age 40')).toBeNull());
  });

  it('shows a retry action when statistics fail to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let thresholdAttempts = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/thresholds')) {
        thresholdAttempts += 1;
        if (thresholdAttempts === 1) return Promise.reject(new Error('Temporary failure'));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockThresholdData) });
      }
      if (url.includes('/api/activities/progress-history')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProgressHistory) });
      }
      if (url.includes('/api/activities/volume')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockVolumeMonth) });
      }
      if (url.includes('/api/profile')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ profile: { age: 40, gender: 'Male' } }) });
      }
      return Promise.reject(new Error(`Unhandled fetch url: ${url}`));
    }));

    render(<StatsView />);
    expect(await screen.findByText('Could not load statistics.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Training Volume & Effort Analytics')).toBeDefined();
  });

  it('allows the training volume card to retry independently', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let volumeAttempts = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('/api/thresholds')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockThresholdData) });
      }
      if (url.includes('/api/activities/progress-history')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProgressHistory) });
      }
      if (url.includes('/api/activities/volume')) {
        volumeAttempts += 1;
        if (volumeAttempts === 1) return Promise.reject(new Error('Temporary failure'));
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockVolumeMonth) });
      }
      if (url.includes('/api/profile')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ profile: { age: 40, gender: 'Male' } }) });
      }
      if (url.includes('/api/activities/training-load') || url.includes('/api/activities/best-efforts')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.reject(new Error(`Unhandled fetch url: ${url}`));
    }));

    render(<StatsView />);
    expect(await screen.findByText('Could not load training volume.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Total Distance')).toBeDefined();
  });
});
