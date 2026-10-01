// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
      elevation_change_m: 4,
      avg_cadence: 180,
      avg_stance_time: 250,
      avg_vert_osc: 75
    },
    {
      id: 2,
      split_index: 2,
      distance_meters: 1000,
      duration_seconds: 320,
      avg_pace_sec_km: 320, // 5:20/km
      avg_heart_rate: 140,
      split_efficiency_factor: 1.19,
      elevation_change_m: -2,
      avg_cadence: 178,
      avg_stance_time: 248,
      avg_vert_osc: 72
    },
    {
      id: 3,
      split_index: 3,
      distance_meters: 1000,
      duration_seconds: 310,
      avg_pace_sec_km: 310, // 5:10/km (Fastest)
      avg_heart_rate: 145,
      split_efficiency_factor: 1.25,
      elevation_change_m: 1,
      avg_cadence: 176,
      avg_stance_time: 246,
      avg_vert_osc: 70
    },
    {
      id: 4,
      split_index: 4,
      distance_meters: 1000,
      duration_seconds: 312,
      avg_pace_sec_km: 312, // 5:12/km
      avg_heart_rate: 148,
      split_efficiency_factor: 1.23,
      elevation_change_m: -1,
      avg_cadence: 174,
      avg_stance_time: 244,
      avg_vert_osc: 68
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

  it('shows labeled running dynamics below pace, with heart rate at the row end', () => {
    const { container } = render(<KmSplitsVisualizer splits={mockSplits} overallAvgPace={318} />);

    const firstRow = container.querySelector('.split-bar-row:first-child');
    expect(firstRow?.querySelector('.split-heart-rate')?.textContent).toBe('135 bpm');
    expect(firstRow?.querySelector('.split-telemetry')?.textContent).toContain('Cad 180 spm');
    expect(firstRow?.querySelector('.split-telemetry')?.textContent).toContain('GCT 250 ms');
    expect(firstRow?.querySelector('.split-telemetry')?.textContent).toContain('VO 7.5 cm');
    expect(firstRow?.querySelector('.split-telemetry')?.textContent).toContain('Stride 2.02 m');
    expect(firstRow?.querySelector('.split-bar-fill')).toBeTruthy();
    expect(firstRow?.querySelector('.split-heart-rate')?.textContent).not.toContain('HR');
  });

  it('keeps splits pace-focused without metric tabs, icons, or pacing-strategy cards', () => {
    const { container } = render(<KmSplitsVisualizer splits={mockSplits} overallAvgPace={318} />);

    expect(container.querySelector('.splits-metric-pills')).toBeNull();
    expect(container.querySelector('.split-insight-card.strategy')).toBeNull();
    expect(screen.queryByText(/Positive Split|Negative Split|Even Pacing/i)).toBeNull();
    expect(container.querySelectorAll('.splits-bar-list svg')).toHaveLength(0);
  });

  it('renders empty state when no splits provided', () => {
    render(<KmSplitsVisualizer splits={[]} />);
    expect(screen.getByText(/No kilometer split data available/i)).toBeTruthy();
  });
});
