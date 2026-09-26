// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { BrowseView, getDisplayTitle, ActivitySummary } from '../../src/frontend/components/BrowseView.js';

describe('BrowseView User Flow & Navigation Tests', () => {
  const mockActivities = [
    {
      id: 'act-101',
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
      tags: JSON.stringify(['Easy Base', 'Recovery']),
      training_load: 68
    }
  ];

  const mockDetailData = {
    activity: {
      ...mockActivities[0],
      notes: 'Smooth morning run in Zone 2.'
    },
    splits: [
      { id: 1, split_index: 1, avg_pace_sec_km: 340, duration_seconds: 340, avg_heart_rate: 132, split_efficiency_factor: 1.22, elevation_change_m: 2 }
    ],
    intervals: [
      { id: 1, interval_index: 1, type: 'stride', duration_seconds: 25, distance_meters: 120, avg_speed_mps: 4.8, avg_heart_rate: 152, max_heart_rate: 158, avg_cadence: 195, hr_drop: 22 }
    ],
    records: [],
    coachSummary: {
      headline: 'Near-Perfect Aerobic Base Execution',
      effectivenessScore: 95,
      keyInsights: [
        'Superb cardiovascular stability with only 2.1% drift.',
        'Cadence was right in the sweet spot (176 spm).'
      ],
      recommendation: 'Absorbing volume smoothly. Ready for progressive tempo.'
    }
  };

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, opts?: any) => {
      const urlStr = String(url);
      if (opts?.method === 'PATCH') {
        const body = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            activity: {
              ...mockDetailData.activity,
              ...body,
              tags: Array.isArray(body.tags) ? JSON.stringify(body.tags) : body.tags
            }
          })
        } as any;
      }

      if (urlStr.includes('/api/activities/act-pause-1')) {
        return {
          ok: true,
          json: async () => ({
            ...mockDetailData,
            activity: {
              ...mockDetailData.activity,
              id: 'act-pause-1',
              avg_pace_sec_km: 436,
              avg_cadence: 156,
              avg_heart_rate: 128,
              steady_pace_sec_km: 395,
              steady_cadence: 175,
              steady_heart_rate: 131,
              steady_stance_time: 261,
              pause_duration_seconds: 63,
              walk_duration_seconds: 88,
              walk_distance_meters: 105
            }
          })
        } as any;
      }

      if (urlStr.includes('/api/activities/act-101')) {
        return {
          ok: true,
          json: async () => mockDetailData
        } as any;
      }

      return {
        ok: true,
        json: async () => ({ activities: mockActivities })
      } as any;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('evaluates getDisplayTitle with smart overrides and presets', () => {
    expect(getDisplayTitle({ name: 'Singapore Running', run_type: 'easy_base' })).toBe('Easy Aerobic Base');
    expect(getDisplayTitle({ name: 'Singapore Running', run_type: 'threshold_lt2' })).toBe('Lactate Threshold (LT2)');
    expect(getDisplayTitle({ name: 'Singapore Running', run_type: 'intervals_vo2' })).toBe('VO2 Max Intervals');
    expect(getDisplayTitle({ name: 'StanChart Half Marathon 2026', run_type: 'race' })).toBe('StanChart Half Marathon 2026');
  });

  it('renders sidebar sessions and loads activity telemetry deep dive', async () => {
    render(
      <BrowseView
        activities={mockActivities}
        selectedActivityId="act-101"
        onSelectActivity={vi.fn()}
        onOpenUpload={vi.fn()}
        theme="dark"
      />
    );

    // Wait for activity detail to load
    await waitFor(() => {
      expect(screen.getByText('Easy Aerobic Base')).toBeTruthy();
    });

    // Check telemetry metrics
    expect(screen.getByText('Aerobic Decoupling (Pa:Hr)')).toBeTruthy();
    expect(screen.getByText('2.1%')).toBeTruthy();
    expect(screen.getByText('Running Economy (EF)')).toBeTruthy();
    expect(screen.getByText('1.25')).toBeTruthy();
  });

  it('reloads the selected activity detail when restored database data changes', async () => {
    const restoredDetail = {
      ...mockDetailData,
      activity: { ...mockDetailData.activity, name: 'Restored Database Run' }
    };
    let detailRequestCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const responseData = detailRequestCount++ === 0 ? mockDetailData : restoredDetail;
      return { ok: true, json: async () => responseData } as any;
    });
    const onActivityUpdated = vi.fn();
    const props = {
      activities: mockActivities,
      selectedActivityId: 'act-101',
      onSelectActivity: vi.fn(),
      onOpenUpload: vi.fn(),
      onActivityUpdated,
      theme: 'dark' as const
    };

    const { rerender } = render(<BrowseView {...props} dataRefreshKey={0} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Easy Aerobic Base')).toBeTruthy();

    // The selected ID is unchanged after restore, so the refresh signal must
    // trigger a new detail request on its own.
    rerender(<BrowseView {...props} dataRefreshKey={1} />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onActivityUpdated).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Restored Database Run' })));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('navigates through subtabs: Strides & Intervals, then Analysis', async () => {
    render(
      <BrowseView
        activities={mockActivities}
        selectedActivityId="act-101"
        onSelectActivity={vi.fn()}
        onOpenUpload={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Easy Aerobic Base')).toBeTruthy();
    });

    // Switch to Strides subtab
    const stridesTabBtn = screen.getByRole('button', { name: /strides & intervals/i });
    fireEvent.click(stridesTabBtn);

    await waitFor(() => {
      expect(screen.getByText(/snapped prescription hint/i)).toBeTruthy();
      expect(screen.getByText('195')).toBeTruthy(); // Cadence of interval
    });

    // Switch to the Analysis subtab
    const coachTabBtn = screen.getByRole('button', { name: /analysis/i });
    fireEvent.click(coachTabBtn);

    await waitFor(() => {
      expect(screen.getByText('Near-Perfect Aerobic Base Execution')).toBeTruthy();
      // Emblem shows stars + score only (no label text) — verify score appears in badge
      expect(screen.queryByText('95/100')).toBeNull();
      expect(screen.getAllByText('Insufficient evidence').length).toBeGreaterThan(0);
      expect(screen.getByText(/superb cardiovascular stability with only 2\.1% drift/i)).toBeTruthy();
      expect(screen.getByText(/ready for progressive tempo/i)).toBeTruthy();
    });
  });

  it('allows renaming activity title inline', async () => {
    render(
      <BrowseView
        activities={mockActivities}
        selectedActivityId="act-101"
        onSelectActivity={vi.fn()}
        onOpenUpload={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(screen.getByTitle(/rename activity/i)).toBeTruthy();
    });

    const editBtn = screen.getByTitle(/rename activity/i);
    fireEvent.click(editBtn);

    const titleInput = screen.getByRole('textbox');
    fireEvent.change(titleInput, { target: { value: 'Saturday Sunrise Zone 2' } });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/activities/act-101',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'Saturday Sunrise Zone 2' })
        })
      );
    });
  });

  it('supports tag removal and adding preset tags', async () => {
    render(
      <BrowseView
        activities={mockActivities}
        selectedActivityId="act-101"
        onSelectActivity={vi.fn()}
        onOpenUpload={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('Recovery').length).toBeGreaterThan(0);
    });

    // Open tag menu
    const addTagBtn = screen.getByRole('button', { name: /tag/i });
    fireEvent.click(addTagBtn);

    // Ensure no free-form text input exists for typing arbitrary new tags
    expect(screen.queryByPlaceholderText(/type tag/i)).toBeNull();

    // Click 'Strides' preset
    const presetBtn = screen.getByText('Strides', { selector: 'span' });
    fireEvent.click(presetBtn);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/activities/act-101',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ tags: ['Easy Base', 'Recovery', 'Strides'] })
        })
      );
    });
  });

  it('renders steady-state running metrics and isolates traffic stops/walk breaks', async () => {
    const activityWithPauses = {
      ...mockActivities[0],
      id: 'act-pause-1',
      avg_pace_sec_km: 436, // 7:16/km
      avg_cadence: 156,     // Garmin raw avg skewed by zeros/walks
      avg_heart_rate: 128,
      steady_pace_sec_km: 395, // 6:35/km true steady run
      steady_cadence: 175,     // 175 spm sweet spot
      steady_heart_rate: 131,
      steady_stance_time: 261,
      pause_duration_seconds: 63,
      walk_duration_seconds: 88,
      walk_distance_meters: 105
    };

    render(
      <BrowseView
        activities={[activityWithPauses]}
        selectedActivityId="act-pause-1"
        onSelectActivity={vi.fn()}
        onOpenUpload={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Steady-State Running Isolated:/i)).toBeTruthy();
    });

    // Check banner content
    expect(screen.getByText(/6:35\/km pace/i)).toBeTruthy();
    expect(screen.getByText(/175 spm cadence/i)).toBeTruthy();
    expect(screen.getByText(/131 bpm HR/i)).toBeTruthy();
    expect(screen.getByText(/261 ms GCT/i)).toBeTruthy();

    // Check exclusion detail
    expect(screen.getByText(/Excludes 1:03 traffic stops & 1:28 walk breaks \(105m\)/i)).toBeTruthy();

    // Check that metric chips show steady state and display raw Garmin values
    expect(screen.getByText(/Raw: 7:16/i)).toBeTruthy();
    expect(screen.getByText(/Raw: 156 spm/i)).toBeTruthy();
  });

  it('renders tags on sidebar cards and displays score aligned on the right below tags', async () => {
    const activityWithStrides: ActivitySummary = {
      id: 'act-strides-1',
      start_time: '2026-09-13T07:00:00Z',
      name: 'Singapore - Medium Run with Strides',
      run_type: 'long_run',
      distance_meters: 14200,
      duration_seconds: 4800,
      avg_pace_sec_km: 338,
      avg_heart_rate: 145,
      max_heart_rate: 172,
      avg_cadence: 176,
      calories: 900,
      elevation_gain_m: 20,
      avg_temperature: 29,
      avg_vertical_oscillation: 7.2,
      avg_stance_time: 240,
      efficiency_factor: 1.25,
      aerobic_decoupling_pct: 2.5,
      meters_per_beat: 1.25,
      tags: '["Long Run","Strides"]',
      verdict: 'on_track' as const,
      effectiveness_score: 96
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('act-strides-1')) {
        return {
          ok: true,
          json: async () => ({
            activity: activityWithStrides,
            splits: [],
            intervals: [
              { id: 1, interval_index: 1, type: 'recovery', duration_seconds: 1200, distance_meters: 3000, avg_pace_sec_km: 400, avg_heart_rate: 135, max_heart_rate: 145 },
              { id: 2, interval_index: 2, type: 'stride', duration_seconds: 25, distance_meters: 120, avg_pace_sec_km: 208, avg_heart_rate: 148, max_heart_rate: 165, peak_cadence: 198, min_stance_time: 185 },
              { id: 3, interval_index: 3, type: 'recovery', duration_seconds: 90, distance_meters: 150, avg_pace_sec_km: 600, avg_heart_rate: 135, max_heart_rate: 162, hr_drop: 27 },
              { id: 4, interval_index: 4, type: 'work', duration_seconds: 240, distance_meters: 1000, avg_pace_sec_km: 240, avg_heart_rate: 178, max_heart_rate: 192, peak_cadence: 188, min_stance_time: 215 },
              { id: 5, interval_index: 5, type: 'recovery', duration_seconds: 120, distance_meters: 180, avg_pace_sec_km: 666, avg_heart_rate: 150, max_heart_rate: 190, hr_drop: 40 }
            ],
            records: [],
            coachSummary: {
              headline: 'Masterful Execution',
              verdict: 'on_track',
              effectivenessScore: 96,
              rating5: 4.8,
              keyInsights: ['Superb consistency'],
              recommendation: 'Rest well.'
            }
          })
        } as any;
      }
      return {
        ok: true,
        json: async () => mockDetailData
      } as any;
    });

    render(
      <BrowseView
        activities={[activityWithStrides]}
        selectedActivityId="act-strides-1"
        onSelectActivity={vi.fn()}
        onOpenUpload={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      // Tags should appear on sidebar card
      const strideChips = screen.getAllByText('Strides');
      expect(strideChips.length).toBeGreaterThanOrEqual(1);

      // Execution emblem should appear on sidebar card (score 96 = Gold tier = 3 stars, no text label)
      const emblem = screen.getByTitle('On track');
      expect(emblem).toBeTruthy();
      expect(emblem.textContent).toContain('✓');
      expect(emblem.textContent).not.toContain('★');
    });

    // Check intervals table work reps toggle & peak HR
    const stridesTabBtn = await screen.findByRole('button', { name: /strides & intervals/i });
    fireEvent.click(stridesTabBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /only \(\d+\)/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /all segments/i })).toBeTruthy();
      expect(screen.getByText('192')).toBeTruthy(); // Peak HR of work rep
      expect(screen.getByText(/-40/)).toBeTruthy(); // Recovery drop after work rep
    });
  });

  it('toggles interactive calendar date picker, selects day, and clears filter', async () => {
    const onSelect = vi.fn();
    render(
      <BrowseView
        activities={mockActivities}
        selectedActivityId="act-101"
        onSelectActivity={onSelect}
        onOpenUpload={vi.fn()}
        theme="dark"
      />
    );

    // Initial header displays "Sessions" cleanly
    expect(screen.getByText('Sessions')).toBeTruthy();

    // Toggle calendar open
    const calToggleBtn = screen.getByRole('button', { name: /calendar/i });
    act(() => {
      fireEvent.click(calToggleBtn);
    });

    // Calendar popover is now visible with month header
    expect(screen.getAllByText(/September 2026/i).length).toBeGreaterThanOrEqual(1);

    // Click on day 12 (act-101 date)
    const day12Btn = screen.getByTitle(/2026-09-12: 1 run$/i);
    expect(day12Btn).toBeTruthy();
    act(() => {
      fireEvent.click(day12Btn);
    });

    // onSelectActivity should be triggered
    expect(onSelect).toHaveBeenCalledWith('act-101');

    // Dedicated active filter bar should now be visible with clear button
    const clearBtn = screen.getByTitle(/show all sessions/i);
    expect(clearBtn).toBeTruthy();
    act(() => {
      fireEvent.click(clearBtn);
    });

    // Filter reset back to all sessions
    expect(screen.queryByTitle(/show all sessions/i)).toBeNull();
  });

  it('quickly changes year in calendar via year selector pills and year navigation chevrons', async () => {
    const multiYearActivities = [
      ...mockActivities,
      {
        ...mockActivities[0],
        id: 'act-2025-1',
        start_time: '2025-10-15 07:00:00'
      }
    ];

    render(
      <BrowseView
        activities={multiYearActivities}
        selectedActivityId="act-101"
        onSelectActivity={vi.fn()}
        onOpenUpload={vi.fn()}
        theme="dark"
      />
    );

    // Open calendar
    const calToggleBtn = screen.getByRole('button', { name: /calendar/i });
    act(() => {
      fireEvent.click(calToggleBtn);
    });

    // Quick Year Selector Pills should be rendered (2025 and 2026)
    const year2025Pill = screen.getByTitle(/jump to 2025/i);
    expect(year2025Pill).toBeTruthy();

    // Click 2025 pill
    act(() => {
      fireEvent.click(year2025Pill);
    });

    // Calendar view should now display 2025
    expect(screen.getAllByText(/September 2025/i).length).toBeGreaterThanOrEqual(1);

    // Next year double-chevron (+1 year)
    const nextYearBtn = screen.getByTitle(/next year/i);
    expect(nextYearBtn).toBeTruthy();
    act(() => {
      fireEvent.click(nextYearBtn);
    });

    // Calendar view jumps back to 2026
    expect(screen.getAllByText(/September 2026/i).length).toBeGreaterThanOrEqual(1);

    // Previous year double-chevron (-1 year)
    const prevYearBtn = screen.getByTitle(/previous year/i);
    expect(prevYearBtn).toBeTruthy();
    act(() => {
      fireEvent.click(prevYearBtn);
    });

    // Calendar view jumps back to 2025
    expect(screen.getAllByText(/September 2025/i).length).toBeGreaterThanOrEqual(1);
  });

  it('disambiguates several runs logged on the same calendar day', () => {
    // Regression: a morning base run plus an evening threshold session on
    // 2026-09-10 used to render two identical "Sep 10, 2026" cards with no way
    // to tell which session was which.
    const sameDayRuns = [
      {
        ...mockActivities[0],
        id: 'act-double-evening',
        start_time: '2026-09-10 19:25:42',
        run_type: 'threshold_lt2',
        distance_meters: 14690,
        avg_pace_sec_km: 391,
        avg_heart_rate: 150,
        tags: JSON.stringify(['Threshold']),
        effectiveness_score: 95
      },
      {
        ...mockActivities[0],
        id: 'act-double-morning',
        start_time: '2026-09-10 07:00:00',
        run_type: 'easy_base',
        distance_meters: 11880,
        avg_pace_sec_km: 303,
        avg_heart_rate: 138,
        tags: JSON.stringify(['Easy Base']),
        effectiveness_score: 98
      }
    ];

    render(
      <BrowseView
        activities={sameDayRuns}
        selectedActivityId="act-double-morning"
        onSelectActivity={vi.fn()}
        onOpenUpload={vi.fn()}
        theme="dark"
      />
    );

    // Both cards still carry the shared calendar day ...
    expect(screen.getAllByText(/^Sep 10, 2026/, { selector: '.session-date' })).toHaveLength(2);

    // ... and each one now shows its own start time.
    const morningCard = screen.getByText('07:00').closest('.session-card');
    const eveningCard = screen.getByText('19:25').closest('.session-card');
    expect(morningCard).toBeTruthy();
    expect(eveningCard).toBeTruthy();

    // The earliest run of the day is #1, so the day order is readable.
    expect(morningCard?.textContent).toContain('Run 1 of 2');
    expect(eveningCard?.textContent).toContain('Run 2 of 2');
  });

  it('renders Training Load chip in activity detail header when training_load is present', async () => {
    render(
      <BrowseView
        activities={mockActivities}
        selectedActivityId="act-101"
        onSelectActivity={vi.fn()}
        onOpenUpload={vi.fn()}
        theme="dark"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Training Load')).toBeDefined();
      expect(screen.getByText('68')).toBeDefined();
      expect(screen.getByText('pts')).toBeDefined();
    });
  });
});
