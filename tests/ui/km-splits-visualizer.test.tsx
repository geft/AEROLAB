// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { KmSplitsVisualizer, SplitItem } from '../../src/frontend/components/KmSplitsVisualizer.js';

describe('KmSplitsVisualizer Component Tests', () => {
  afterEach(() => {
    cleanup();
  });

  const mockSplits: SplitItem[] = [
    {
      id: 1,
      split_index: 1,
      distance_meters: 1000,
      duration_seconds: 330,
      avg_pace_sec_km: 330, // 5:30/km
      avg_heart_rate: 135,
      split_efficiency_factor: 1.15,
      elevation_change_m: 4
    },
    {
      id: 2,
      split_index: 2,
      distance_meters: 1000,
      duration_seconds: 320,
      avg_pace_sec_km: 320, // 5:20/km
      avg_heart_rate: 140,
      split_efficiency_factor: 1.19,
      elevation_change_m: -2
    },
    {
      id: 3,
      split_index: 3,
      distance_meters: 1000,
      duration_seconds: 310,
      avg_pace_sec_km: 310, // 5:10/km (Fastest)
      avg_heart_rate: 145,
      split_efficiency_factor: 1.25,
      elevation_change_m: 1
    },
    {
      id: 4,
      split_index: 4,
      distance_meters: 1000,
      duration_seconds: 312,
      avg_pace_sec_km: 312, // 5:12/km
      avg_heart_rate: 148,
      split_efficiency_factor: 1.23,
      elevation_change_m: -1
    }
  ];

  it('renders all kilometer splits with bar rows and values', () => {
    render(<KmSplitsVisualizer splits={mockSplits} overallAvgPace={318} />);

    expect(screen.getAllByText('KM 1').length).toBeGreaterThan(0);
    expect(screen.getByText('KM 2')).toBeTruthy();
    expect(screen.getAllByText('KM 3').length).toBeGreaterThan(0);
    expect(screen.getByText('KM 4')).toBeTruthy();

    // Check that paces are formatted
    expect(screen.getAllByText('5:30/km').length).toBeGreaterThan(0);
    expect(screen.getAllByText('5:10/km').length).toBeGreaterThan(0);
  });

  it('calculates fastest split, slowest split, and pacing spread in banner', () => {
    render(<KmSplitsVisualizer splits={mockSplits} overallAvgPace={318} />);

    expect(screen.getByText('Fastest Split')).toBeTruthy();
    expect(screen.getAllByText('5:10/km').length).toBeGreaterThan(0);
    expect(screen.getAllByText('KM 3').length).toBeGreaterThan(0);

    expect(screen.getByText('Slowest Split')).toBeTruthy();
    expect(screen.getAllByText('5:30/km').length).toBeGreaterThan(0);
    expect(screen.getAllByText('KM 1').length).toBeGreaterThan(0);

    // Spread is 330 - 310 = 20s
    expect(screen.getByText('±20s')).toBeTruthy();
  });

  it('identifies negative split strategy when second half is faster', () => {
    render(<KmSplitsVisualizer splits={mockSplits} overallAvgPace={318} />);

    // First half: (330 + 320)/2 = 325s. Second half: (310 + 312)/2 = 311s. Diff = -14s (Negative split)
    expect(screen.getByText(/Negative Split/i)).toBeTruthy();
  });

  it('toggles metric view to Heart Rate', () => {
    render(<KmSplitsVisualizer splits={mockSplits} overallAvgPace={318} />);

    const hrBtn = screen.getByRole('button', { name: /heart rate/i });
    fireEvent.click(hrBtn);

    // Heart rate values should now be primary
    expect(screen.getByText('135 bpm')).toBeTruthy();
    expect(screen.getByText('148 bpm')).toBeTruthy();
  });

  it('toggles metric view to Efficiency Factor', () => {
    render(<KmSplitsVisualizer splits={mockSplits} overallAvgPace={318} />);

    const efBtn = screen.getByRole('button', { name: /efficiency/i });
    fireEvent.click(efBtn);

    expect(screen.getByText('1.15 EF')).toBeTruthy();
    expect(screen.getByText('1.25 EF')).toBeTruthy();
  });

  it('toggles metric view to Elevation', () => {
    render(<KmSplitsVisualizer splits={mockSplits} overallAvgPace={318} />);

    const elevBtn = screen.getByRole('button', { name: /elevation/i });
    fireEvent.click(elevBtn);

    expect(screen.getByText('+4.0m')).toBeTruthy();
    expect(screen.getByText('-2.0m')).toBeTruthy();
  });

  it('renders empty state when no splits provided', () => {
    render(<KmSplitsVisualizer splits={[]} />);
    expect(screen.getByText(/No kilometer split data available/i)).toBeTruthy();
  });
});
