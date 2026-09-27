// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProgressView } from '../../src/frontend/components/ProgressView.js';

describe('ProgressView UI Tests', () => {
  const mockThresholdData = {
    latest: {
      lt1: {
        lt1_hr: 148,
        lt1_pace_sec_km: 352,
        effective_date: '2026-09-05 17:01:09',
        baseline_economy_ef: 1.19
      },
      lt2: {
        lt2_hr: 171,
        lt2_pace_sec_km: 280,
        effective_date: '2026-09-10 19:25:42'
      },
      vo2Max: 58
    },
    currentThresholds: {
      lt1Hr: 148,
      lt2Hr: 171,
      lt1Range: [147, 149]
    },
    history: [
      {
        id: 1,
        effective_date: '2026-09-05 17:01:09',
        source_activity_id: 'act-001',
        activity_name: 'Singapore - Long Run',
        distance_meters: 17800,
        lt1_hr: 148,
        lt1_pace_sec_km: 352,
        confidence: 0.9,
        notes: 'Calibrated Aerobic Base (LT1) from steady aerobic run'
      },
      {
        id: 2,
        effective_date: '2026-09-10 19:25:42',
        source_activity_id: 'act-002',
        activity_name: 'Singapore - Threshold',
        distance_meters: 14600,
        lt2_hr: 171,
        lt2_pace_sec_km: 280,
        confidence: 0.85,
        notes: 'Calibrated Lactate Threshold (LT2) from structured quality intervals'
      }
    ],
    predictions: [],
    economyTrend: [],
    scatterData: []
  };

  const mockProgressHistory = {
    months: [
      {
        period: '2026-01',
        label: 'Jan 2026',
        runCount: 1,
        totalDistanceKm: 23.8,
        totalDurationHours: 2.6,
        avgEfficiencyFactor: 1.06,
        avgPaceSecKm: 392,
        avgHeartRate: 151,
        zone2Hours: 0.2,
        zone2Pct: 8,
        calibrations: []
      },
      {
        period: '2026-09',
        label: 'Sep 2026',
        runCount: 5,
        totalDistanceKm: 71.6,
        totalDurationHours: 8.2,
        avgEfficiencyFactor: 1.16,
        avgPaceSecKm: 414,
        avgHeartRate: 138,
        zone2Hours: 3.9,
        zone2Pct: 48,
        calibrations: []
      }
    ],
    years: [
      {
        period: '2026',
        label: '2026 Season',
        runCount: 8,
        activeMonths: 4,
        totalDistanceKm: 115.0,
        totalDurationHours: 12.9,
        avgEfficiencyFactor: 1.16,
        avgPaceSecKm: 406,
        avgHeartRate: 145,
        calibrations: []
      }
    ]
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
        return Promise.reject(new Error(`Unhandled fetch url: ${url}`));
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders benchmark cards and threshold markers', async () => {
    const { container } = render(<ProgressView />);

    await waitFor(() => {
      expect(screen.getAllByText('Estimated LT1 Pace').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Estimated LT2 Pace').length).toBeGreaterThan(0);
    expect(screen.getByText('Estimated VO2 Max / VDOT')).toBeDefined();
    expect(screen.getByText('Running Economy Index')).toBeDefined();
    const economyCard = container.querySelector('.benchmark-card:last-child');
    expect(economyCard?.textContent).toContain('Running Economy (EF)');
    expect(economyCard?.textContent).not.toContain('Meters / Beat');
  });

  it('opens and closes VDOT Guide Modal when (?) button is clicked', async () => {
    render(<ProgressView />);

    await waitFor(() => {
      expect(screen.getByText('Estimated VO2 Max / VDOT')).toBeDefined();
    });

    const vdotBtn = screen.getByTitle('What is VDOT & VO2 Max? View equivalent race paces');
    fireEvent.click(vdotBtn);

    // Modal is open
    await waitFor(() => {
      expect(screen.getByText('Estimated VO2 Max & VDOT Guide')).toBeDefined();
      expect(screen.getByText(/Daniels' VDOT/i)).toBeDefined();
    });

    // Close via Got It button
    const closeBtn = screen.getByRole('button', { name: 'Got It' });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Estimated VO2 Max & VDOT Guide')).toBeNull();
    });
  });

  it('opens and closes Running Economy Guide Modal when (?) button is clicked', async () => {
    render(<ProgressView />);

    await waitFor(() => {
      expect(screen.getByText('Running Economy Index')).toBeDefined();
    });

    const economyBtn = screen.getByTitle('What is Running Economy? View benchmark tiers');
    fireEvent.click(economyBtn);

    // Modal is open
    await waitFor(() => {
      expect(screen.getByText('Running Economy Reference Guide')).toBeDefined();
      expect(screen.getByText(/Meters Per Heartbeat/i)).toBeDefined();
    });

    // Close via Got It button
    const closeBtn = screen.getByRole('button', { name: 'Got It' });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText('Running Economy Reference Guide')).toBeNull();
    });
  });

  it('renders PeriodProgressView and toggles between Monthly and Yearly views', async () => {
    render(<ProgressView />);

    await waitFor(() => {
      expect(screen.getByText(/Progress Over Month/i)).toBeDefined();
      expect(screen.getAllByText(/Sep 2026/i).length).toBeGreaterThan(0);
    });

    // Switch to Yearly
    const yearlyBtn = screen.getByRole('button', { name: 'Yearly' });
    fireEvent.click(yearlyBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/2026 Season/i).length).toBeGreaterThan(0);
    });

    // Switch back to Monthly
    const monthlyBtn = screen.getByRole('button', { name: 'Monthly' });
    fireEvent.click(monthlyBtn);

    await waitFor(() => {
      expect(screen.getAllByText(/Sep 2026/i).length).toBeGreaterThan(0);
    });
  });

  it('selects period-chart details with the accessible slider', async () => {
    const { container } = render(<ProgressView />);

    await waitFor(() => expect(container.querySelector('.period-chart-card input[type="range"]')).toBeTruthy());
    const slider = container.querySelector('.period-chart-card input[type="range"]') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '1' } });
    fireEvent.change(slider, { target: { value: '0' } });

    const selection = container.querySelector('.period-chart-selection');
    expect(selection?.textContent).toContain('Jan 2026');
    expect(selection?.textContent).toContain('23.8 km');
  });

  it('renders the Show All in Chart action with the shared rounded outline button style', async () => {
    const fiveMonths = {
      months: ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((period, idx) => ({
        period,
        label: `${period} Block`,
        runCount: 2,
        totalDistanceKm: 20 + idx * 5,
        totalDurationHours: 2.5,
        avgEfficiencyFactor: 1.12,
        avgPaceSecKm: 400,
        avgHeartRate: 142,
        zone2Hours: 1.2,
        zone2Pct: 48,
        calibrations: []
      })),
      years: []
    };

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/thresholds')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(mockThresholdData) });
        }
        if (url.includes('/api/activities/progress-history')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(fiveMonths) });
        }
        return Promise.reject(new Error(`Unhandled fetch url: ${url}`));
      })
    );

    render(<ProgressView />);

    // Card list paginates (3 visible of 5 blocks) so both footer actions render
    const showAllBtn = await screen.findByRole('button', { name: /Show All in Chart/ });
    const loadMoreBtn = screen.getByRole('button', { name: /Load More Cards/ });

    // Secondary action must use the themed outlined class (rounded corners, shared height)
    expect(showAllBtn.className).toContain('outline-btn');
    expect(loadMoreBtn.className).toContain('primary-btn');

    fireEvent.click(showAllBtn);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Show All in Chart/ })).toBeNull();
    });
  });

  it('filters PeriodProgressView by run type (Easy / Base vs Threshold / VO2)', async () => {
    render(<ProgressView />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Easy / Base' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Threshold / VO2' })).toBeDefined();
    });

    // Click Easy / Base
    const easyBtn = screen.getByRole('button', { name: 'Easy / Base' });
    fireEvent.click(easyBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/activities/progress-history?run_type=easy');
    });

    // Click Threshold / VO2
    const threshBtn = screen.getByRole('button', { name: 'Threshold / VO2' });
    fireEvent.click(threshBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/activities/progress-history?run_type=threshold');
    });
  });

  it('toggles between Milestone Cards and Data Table in Historical Threshold Estimates', async () => {
    render(<ProgressView />);

    await waitFor(() => {
      expect(screen.getByText(/Historical Threshold Estimates/i)).toBeDefined();
    });

    // Default is Cards
    expect(screen.getByText('Singapore - Long Run (17.8 km)')).toBeDefined();

    // Switch to Table via title
    const tableBtn = screen.getByTitle('Data Table View');
    fireEvent.click(tableBtn);

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeDefined();
      expect(screen.getByText('Run Source')).toBeDefined();
      expect(screen.getByRole('columnheader', { name: 'Estimated LT1 Pace' })).toBeDefined();
    });

    // Switch back to Cards via title
    const cardsBtn = screen.getByTitle('Organized Milestone Cards');
    fireEvent.click(cardsBtn);

    await waitFor(() => {
      expect(screen.getByText('Singapore - Long Run (17.8 km)')).toBeDefined();
    });
  });

  it('filters historical calibrations by LT1 Base and LT2 Threshold with dynamic count badge', async () => {
    render(<ProgressView />);

    await waitFor(() => {
      expect(screen.getByText('2 of 2')).toBeDefined();
    });

    expect(screen.getByText('Singapore - Long Run (17.8 km)')).toBeDefined();
    expect(screen.getByText('Singapore - Threshold (14.6 km)')).toBeDefined();

    // Click LT1 Base filter
    const lt1Btn = screen.getByRole('button', { name: 'LT1 Base' });
    fireEvent.click(lt1Btn);

    await waitFor(() => {
      expect(screen.getByText('1 of 2')).toBeDefined();
      expect(screen.getByText('Singapore - Long Run (17.8 km)')).toBeDefined();
      expect(screen.queryByText('Singapore - Threshold (14.6 km)')).toBeNull();
    });

    // Click LT2 Threshold filter
    const lt2Btn = screen.getByRole('button', { name: 'LT2 Threshold' });
    fireEvent.click(lt2Btn);

    await waitFor(() => {
      expect(screen.getByText('1 of 2')).toBeDefined();
      expect(screen.getByText('Singapore - Threshold (14.6 km)')).toBeDefined();
      expect(screen.queryByText('Singapore - Long Run (17.8 km)')).toBeNull();
    });

    // Click All filter to reset
    const allBtn = screen.getByRole('button', { name: 'All' });
    fireEvent.click(allBtn);

    await waitFor(() => {
      expect(screen.getByText('2 of 2')).toBeDefined();
      expect(screen.getByText('Singapore - Long Run (17.8 km)')).toBeDefined();
      expect(screen.getByText('Singapore - Threshold (14.6 km)')).toBeDefined();
    });
  });

  it('renders physiological threshold trends chart and toggles between Pace and HR metrics', async () => {
    render(<ProgressView />);

    await waitFor(() => {
      expect(screen.getByText('Estimated Threshold Trends (LT1 & LT2)')).toBeDefined();
    });

    // Check Pace Trend and Heart Rate Trend toggle buttons
    const paceBtn = screen.getByRole('button', { name: /Pace Trend/i });
    const hrBtn = screen.getByRole('button', { name: /Heart Rate Trend/i });
    expect(paceBtn).toBeDefined();
    expect(hrBtn).toBeDefined();

    // Verify Active Baselines exist
    expect(screen.getByText('LT2 Threshold:')).toBeDefined();
    expect(screen.getByText('LT1 Aerobic Base:')).toBeDefined();

    // Toggle to Heart Rate Trend
    fireEvent.click(hrBtn);

    await waitFor(() => {
      expect(hrBtn.className).toContain('active');
    });

    // Toggle to 3 Months range
    const range3mBtns = screen.getAllByRole('button', { name: '3 Months' });
    expect(range3mBtns.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(range3mBtns[0]);

    await waitFor(() => {
      expect(range3mBtns[0].className).toContain('active');
    });
  });

  it('shows a retry action when threshold data fails to load', async () => {
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
      return Promise.reject(new Error(`Unhandled fetch url: ${url}`));
    }));

    render(<ProgressView />);
    expect(await screen.findByText('Could not load progress data.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText('Estimated LT1 Pace')).length).toBeGreaterThan(0);
  });
});
