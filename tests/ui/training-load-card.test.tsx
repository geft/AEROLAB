// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { TrainingLoadCard } from '../../src/frontend/components/TrainingLoadCard.js';

describe('TrainingLoadCard UI Tests', () => {
  const mockTrainingData = {
    trainingStatus: {
      currentAcuteLoad: 520,
      currentChronicLoad: 480,
      acwr: 1.08,
      status: 'optimal',
      statusLabel: 'Optimal Stimulus',
      statusDescription: 'Your training load is in the sweet spot for physiological adaptation.',
      optimalRange: { min: 384, max: 624 },
      last7DaysLoad: 520,
      timeline: [
        {
          date: '2026-09-18',
          dailyLoad: 75,
          acuteLoad: 510,
          chronicLoad: 475,
          optimalMin: 380,
          optimalMax: 618,
          acwr: 1.07
        },
        {
          date: '2026-09-19',
          dailyLoad: 80,
          acuteLoad: 520,
          chronicLoad: 480,
          optimalMin: 384,
          optimalMax: 624,
          acwr: 1.08
        }
      ]
    }
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/activities/training-load')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTrainingData)
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

  it('renders acute load, chronic load, ACWR and status badge', async () => {
    render(<TrainingLoadCard />);

    await waitFor(() => {
      expect(screen.getByText(/Training Load & Optimal Tunnel/i)).toBeDefined();
      expect(screen.getAllByText('520').length).toBeGreaterThanOrEqual(1); // Acute / Raw Load
      expect(screen.getByText('480')).toBeDefined(); // Chronic Load
      expect(screen.getByText(/1.08/)).toBeDefined(); // ACWR
      expect(screen.getByText('Optimal Stimulus')).toBeDefined();
    });
  });

  it('renders optimal tunnel SVG elements and acute path', async () => {
    const { container } = render(<TrainingLoadCard />);

    await waitFor(() => {
      expect(screen.getByText(/Training Load & Optimal Tunnel/i)).toBeDefined();
    });

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();

    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('renders time filter buttons and triggers fetch with chosen range', async () => {
    render(<TrainingLoadCard />);

    await waitFor(() => {
      expect(screen.getByText('7D')).toBeDefined();
      expect(screen.getByText('14D')).toBeDefined();
      expect(screen.getByText('30D')).toBeDefined();
      expect(screen.getByText('60D')).toBeDefined();
      expect(screen.getByText('90D')).toBeDefined();
    });

    const btn60d = screen.getByRole('button', { name: '60D' });
    fireEvent.click(btn60d);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/activities/training-load?days=60');
    });
  });

  it('opens and closes Educational Guide Modal when info (?) button is clicked', async () => {
    render(<TrainingLoadCard />);

    await waitFor(() => {
      expect(screen.getByText(/Training Load & Optimal Tunnel/i)).toBeDefined();
    });

    const infoBtn = screen.getByTitle('Training Load Guide');
    expect(infoBtn).toBeDefined();
    fireEvent.click(infoBtn);

    await waitFor(() => {
      expect(screen.getByText(/Training Load & Optimal Tunnel Guide/i)).toBeDefined();
      expect(screen.getByText(/Heart Rate Reserve/i)).toBeDefined();
      expect(screen.getByText(/Optimal \(0.8 - 1.3 ACWR\)/i)).toBeDefined();
    });

    const closeBtn = screen.getByRole('button', { name: /got it/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Training Load & Optimal Tunnel Guide/i)).toBeNull();
    });
  });
});
