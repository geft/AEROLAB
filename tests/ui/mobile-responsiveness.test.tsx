// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { BrowseView } from '../../src/frontend/components/BrowseView.js';
import { Navbar } from '../../src/frontend/components/Navbar.js';

describe('Mobile Responsiveness & View Switcher UI Tests', () => {
  const mockActivities = [
    {
      id: 'act-mobile-1',
      start_time: '2026-09-12 07:00:00',
      name: 'Singapore Morning Run',
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
    },
    {
      id: 'act-mobile-2',
      start_time: '2026-09-14 07:00:00',
      name: 'Interval Workout',
      run_type: 'intervals_vo2',
      distance_meters: 10000,
      duration_seconds: 3200,
      avg_pace_sec_km: 310,
      avg_heart_rate: 158,
      max_heart_rate: 178,
      avg_cadence: 184,
      calories: 680,
      elevation_gain_m: 15,
      avg_temperature: 29,
      avg_vertical_oscillation: 78,
      avg_stance_time: 225,
      efficiency_factor: 1.35,
      aerobic_decoupling_pct: 3.2,
      meters_per_beat: 3.3,
      tags: JSON.stringify(['VO2 Max'])
    }
  ];

  const mockDetailData = {
    activity: mockActivities[0],
    splits: [],
    intervals: [],
    records: [],
    coachSummary: {
      headline: 'Smooth Aerobic Run',
      effectivenessScore: 90,
      keyInsights: ['Solid pacing.'],
      recommendation: 'Good recovery.'
    }
  };

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any) => {
      return {
        ok: true,
        json: async () => mockDetailData
      } as any;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders mobile browse segmented control with Sessions and Run Analysis buttons', () => {
    render(
      <BrowseView
        activities={mockActivities}
        selectedActivityId={mockActivities[0].id}
        onSelectActivity={vi.fn()}
      />
    );

    const segmentedControl = screen.getByRole('tablist', { name: /Browse View Switcher/i });
    expect(segmentedControl).toBeTruthy();

    const sessionsBtn = screen.getByRole('button', { name: /Sessions \(2\)/i });
    const analysisBtn = screen.getByRole('button', { name: /Telemetry|Analysis/i });
    expect(sessionsBtn).toBeTruthy();
    expect(analysisBtn).toBeTruthy();
  });

  it('switches between list and detail via segmented control tabs', async () => {
    const { container } = render(
      <BrowseView
        activities={mockActivities}
        selectedActivityId={mockActivities[0].id}
        onSelectActivity={vi.fn()}
      />
    );

    const browseGrid = container.querySelector('.browse-grid');
    expect(browseGrid?.className).toContain('mobile-show-list');

    // Click Run Telemetry tab
    const analysisBtn = screen.getByRole('button', { name: /Telemetry|Analysis/i });
    await act(async () => {
      fireEvent.click(analysisBtn);
    });

    expect(browseGrid?.className).toContain('mobile-show-detail');

    // Click Sessions tab to switch back
    const sessionsBtn = screen.getByRole('button', { name: /Sessions \(2\)/i });
    await act(async () => {
      fireEvent.click(sessionsBtn);
    });

    expect(browseGrid?.className).toContain('mobile-show-list');
  });

  it('automatically switches to detail view when a session card is clicked', async () => {
    const onSelectActivity = vi.fn();
    const { container } = render(
      <BrowseView
        activities={mockActivities}
        selectedActivityId={mockActivities[0].id}
        onSelectActivity={onSelectActivity}
      />
    );

    const browseGrid = container.querySelector('.browse-grid');
    expect(browseGrid?.className).toContain('mobile-show-list');

    // Click the second activity session card
    const cards = container.querySelectorAll('.session-card');
    expect(cards.length).toBe(2);
    await act(async () => {
      fireEvent.click(cards[1]);
    });

    expect(onSelectActivity).toHaveBeenCalledWith('act-mobile-2');
    expect(browseGrid?.className).toContain('mobile-show-detail');
  });

  it('returns to sessions list when clicking Back to Sessions List in detail panel', async () => {
    const { container } = render(
      <BrowseView
        activities={mockActivities}
        selectedActivityId={mockActivities[0].id}
        onSelectActivity={vi.fn()}
      />
    );

    const browseGrid = container.querySelector('.browse-grid');

    // Switch to detail view
    const analysisBtn = screen.getByRole('button', { name: /Telemetry|Analysis/i });
    await act(async () => {
      fireEvent.click(analysisBtn);
    });
    expect(browseGrid?.className).toContain('mobile-show-detail');

    // Click "← Back to Sessions List"
    await waitFor(async () => {
      const backBtn = screen.getByRole('button', { name: /← Back to sessions/i });
      await act(async () => {
        fireEvent.click(backBtn);
      });
    });

    expect(browseGrid?.className).toContain('mobile-show-list');
  });

  it('opens a session card with Enter from the keyboard', () => {
    const onSelectActivity = vi.fn();
    const { container } = render(
      <BrowseView
        activities={mockActivities}
        selectedActivityId={mockActivities[0].id}
        onSelectActivity={onSelectActivity}
      />
    );

    const firstCard = container.querySelector('.session-card');
    expect(firstCard?.getAttribute('role')).toBe('button');
    fireEvent.keyDown(firstCard!, { key: 'Enter' });
    expect(onSelectActivity).toHaveBeenCalledWith(mockActivities[0].id);
  });

  it('Navbar renders navigation icons and labels for mobile bottom navigation', () => {
    const { container } = render(
      <Navbar
        activeTab="browse"
        onTabChange={vi.fn()}
        theme="dark"
        onToggleTheme={vi.fn()}
      />
    );

    const icons = container.querySelectorAll('.nav-tab-icon');
    expect(icons.length).toBe(5);

    const labels = container.querySelectorAll('.nav-tab-label');
    expect(labels.length).toBe(5);
    expect(labels[0].textContent).toBe('Browse');
    expect(labels[1].textContent).toBe('Progress');
    expect(labels[2].textContent).toBe('Stats');
    expect(labels[3].textContent).toBe('Profile');
    expect(labels[4].textContent).toBe('Settings');
  });
});
