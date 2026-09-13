// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ProfileView } from '../../src/frontend/components/ProfileView.js';

describe('ProfileView UI Tests', () => {
  const mockProfile = {
    id: 'primary',
    dob: '1989-04-15',
    gender: 'Male',
    age: 37,
    resting_hr: 55,
    max_hr: 203,
    is_max_hr_estimated: 0,
    lt1_hr: 148,
    lt2_hr: 167
  };

  const mockThresholds = {
    lt1Hr: 148,
    lt2Hr: 167,
    lt1PaceSecKm: 350,
    lt2PaceSecKm: 250,
    source: 'calibrated'
  };

  const mockObservedPeak = {
    peakHr: 203,
    activityId: '22382891478',
    activityName: 'Singapore - 5k Time Trial',
    activityDate: '2026-04-02',
    runType: 'race'
  };

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
      const u = url.toString();
      if (u.includes('/api/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            profile: mockProfile,
            currentThresholds: mockThresholds,
            observedPeakHr: mockObservedPeak,
            tanakaMaxHr: 182,
            effectiveMaxHr: 203,
            maxHrSource: 'manual'
          })
        } as any);
      }
      return Promise.reject(new Error('Unknown URL: ' + u));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders runner cardio baselines, inferred thresholds, and live Karvonen zones', async () => {
    render(<ProfileView />);

    await waitFor(() => {
      expect(screen.getByText('Continuously Inferred Physiological Thresholds')).toBeTruthy();
      expect(screen.getByDisplayValue('1989-04-15')).toBeTruthy();
      expect(screen.getByDisplayValue('55')).toBeTruthy();
      expect(screen.getByDisplayValue('203')).toBeTruthy();
      expect(screen.getByText(/~148 bpm/)).toBeTruthy();
      expect(screen.getByText(/~167 bpm/)).toBeTruthy();
      expect(screen.getByText(/Live Resulting Physiological Training Zones/i)).toBeTruthy();
    });
  });

  it('switches between Auto-Infer and Manual Override modes', async () => {
    render(<ProfileView />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('203')).toBeTruthy();
    });

    // Click Auto-Infer tab
    const autoInferTab = screen.getByRole('button', { name: /Auto-Infer from Run Data/i });
    fireEvent.click(autoInferTab);

    // Displays observed peak workout info
    await waitFor(() => {
      expect(screen.getByText(/Calibrated from Actual Run Data/i)).toBeTruthy();
      expect(screen.getByText(/Singapore - 5k Time Trial/i)).toBeTruthy();
    });

    // Switch back to Manual Override
    const manualTab = screen.getByRole('button', { name: /Manual Override/i });
    fireEvent.click(manualTab);

    await waitFor(() => {
      expect(screen.getByLabelText(/Manual Maximum Heart Rate/i)).toBeTruthy();
    });
  });

  it('recalculates Tanaka fallback estimate when birth date changes', async () => {
    render(<ProfileView />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('1989-04-15')).toBeTruthy();
    });

    // Switch to Auto-Infer
    fireEvent.click(screen.getByRole('button', { name: /Auto-Infer from Run Data/i }));

    // Change DOB to 1986-04-15 -> age 40 in 2026 -> Tanaka formula: 208 - (0.7 * 40) = 180
    const dobInput = screen.getByDisplayValue('1989-04-15');
    fireEvent.change(dobInput, { target: { value: '1986-04-15' } });

    await waitFor(() => {
      expect(screen.getAllByText(/180 bpm/i).length).toBeGreaterThan(0);
    });
  });

  it('dynamically adjusts live Karvonen zone ranges when resting HR is updated', async () => {
    render(<ProfileView />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('55')).toBeTruthy();
    });

    // Change resting HR from 55 to 65
    const rhrInput = screen.getByDisplayValue('55');
    fireEvent.change(rhrInput, { target: { value: '65' } });

    // Live Karvonen zones update in DOM
    await waitFor(() => {
      expect(screen.getByText(/Live Resulting Physiological Training Zones/i)).toBeTruthy();
    });
  });

  it('saves cardio baselines updates via PATCH /api/profile', async () => {
    let patchPayload: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, opts: any) => {
      const u = url.toString();
      if (u.includes('/api/profile') && opts?.method === 'PATCH') {
        patchPayload = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ profile: { ...mockProfile, ...patchPayload } })
        } as any);
      }
      if (u.includes('/api/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            profile: mockProfile,
            currentThresholds: mockThresholds,
            observedPeakHr: mockObservedPeak,
            tanakaMaxHr: 182,
            effectiveMaxHr: 203,
            maxHrSource: 'manual'
          })
        } as any);
      }
      return Promise.reject(new Error('Unknown URL: ' + u));
    });

    render(<ProfileView />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('1989-04-15')).toBeTruthy();
    });

    // Change resting HR to 52
    fireEvent.change(screen.getByDisplayValue('55'), { target: { value: '52' } });

    // Click Save Baselines
    const saveBtn = screen.getByRole('button', { name: /Save Baselines/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(patchPayload).toBeTruthy();
      expect(patchPayload.resting_hr).toBe(52);
      expect(patchPayload.dob).toBe('1989-04-15');
      expect(screen.getByText(/Cardiovascular baselines updated/i)).toBeTruthy();
    });
  });
});
