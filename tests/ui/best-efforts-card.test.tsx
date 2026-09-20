// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BestEffortsCard } from '../../src/frontend/components/BestEffortsCard.js';

describe('BestEffortsCard UI Tests', () => {
  const currentYear = new Date().getFullYear().toString();

  const mockBestEffortsData = {
    targets: [
      { id: '1k', label: '1 km', distanceMeters: 1000 },
      { id: '5k', label: '5 km', distanceMeters: 5000 },
      { id: '10k', label: '10 km', distanceMeters: 10000 },
      { id: 'hm', label: 'Half Marathon', distanceMeters: 21097.5 },
      { id: 'mar', label: 'Marathon', distanceMeters: 42195 }
    ],
    allTime: [
      {
        targetId: '5k',
        label: '5 km',
        distanceMeters: 5000,
        timeSeconds: 1250,
        paceSecKm: 250,
        activityId: 'act-pr-5k',
        activityName: 'Morning Fast 5K',
        activityDate: '2026-08-15'
      }
    ],
    currentYear: [
      {
        targetId: '5k',
        label: '5 km',
        distanceMeters: 5000,
        timeSeconds: 1280,
        paceSecKm: 256,
        activityId: 'act-yr-5k',
        activityName: 'Tempo Run',
        activityDate: '2026-09-02'
      }
    ]
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/activities/best-efforts')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockBestEffortsData)
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

  it('renders all-time personal best records with time and pace', async () => {
    render(<BestEffortsCard />);

    await waitFor(() => {
      expect(screen.getByText(/Personal Best Efforts/i)).toBeDefined();
      expect(screen.getByText('5 km')).toBeDefined();
      expect(screen.getByText('20:50')).toBeDefined(); // 1250s
      expect(screen.getByText(/4:10\/km/i)).toBeDefined(); // 250s/km
    });
  });

  it('lists every tracked distance and leaves un-raced ones as empty placeholders', async () => {
    const { container } = render(<BestEffortsCard />);

    await waitFor(() => {
      expect(screen.getByText('5 km')).toBeDefined();
    });

    // 1 Mile must no longer be a tracked benchmark
    expect(screen.queryByText(/1 Mile|1 英里/)).toBeNull();

    // ...while Marathon is displayed as an ordinary empty slot
    expect(screen.getByText('Marathon')).toBeDefined();
    expect(screen.getByText('Half Marathon')).toBeDefined();

    // No literal copy — empty distances use the app-wide "--:--" / "—" placeholders
    expect(screen.queryByText(/nothing yet/i)).toBeNull();
    expect(screen.queryByText('暂无成绩')).toBeNull();
    expect(screen.getAllByText('--:--').length).toBe(4);
    expect(screen.getAllByText('—').length).toBe(4);

    const cards = container.querySelectorAll('div[style*="border-radius: 10px"]');
    expect(cards.length).toBe(5);
  });

  it('toggles scope to current year and displays year records', async () => {
    render(<BestEffortsCard />);

    await waitFor(() => {
      expect(screen.getByText('20:50')).toBeDefined();
    });

    // Click current year button
    const yearBtn = screen.getByText(currentYear);
    fireEvent.click(yearBtn);

    await waitFor(() => {
      expect(screen.getByText('21:20')).toBeDefined(); // 1280s
      expect(screen.getByText(/4:16\/km/i)).toBeDefined(); // 256s/km
    });
  });

  it('renders empty placeholder when records array is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ allTime: [], currentYear: [] })
        })
      )
    );

    render(<BestEffortsCard />);

    await waitFor(() => {
      expect(screen.getByText(/No benchmark records logged for this period yet/i)).toBeDefined();
    });
  });
});
