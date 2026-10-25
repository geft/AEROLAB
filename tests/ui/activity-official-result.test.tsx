// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ActivityDetailHeader } from '../../src/frontend/components/browse/ActivityDetailHeader.js';
import { LanguageProvider } from '../../src/frontend/i18n/LanguageContext.js';
import { en } from '../../src/frontend/i18n/en.js';
import { formatDuration, formatPace } from '../../src/frontend/utils/formatters.js';
import type { Activity } from '../../src/frontend/types/api.js';

const baseActivity = {
  id: 'race-10k',
  name: 'Singapore 10K',
  start_time: '2026-10-25 06:00:25',
  run_type: 'race',
  distance_meters: 9988.84,
  duration_seconds: 2817,
  avg_pace_sec_km: 282,
  avg_heart_rate: 186,
  avg_cadence: 186
} as Activity;

const renderHeader = (overrides: Partial<Activity> = {}, onActivityUpdated = vi.fn()) => {
  render(
    <LanguageProvider>
      <ActivityDetailHeader
        act={{ ...baseActivity, ...overrides }}
        records={[]}
        getDisplayTitle={activity => activity.name ?? 'Run'}
        formatPace={formatPace}
        formatTime={formatDuration}
        getTimeOfDay={() => 'Early morning'}
        onActivityUpdated={onActivityUpdated}
        onRefreshWeather={() => undefined}
        isRefreshingWeather={false}
        t={en}
      />
    </LanguageProvider>
  );
  return onActivityUpdated;
};

describe('official race result editor', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ activity: baseActivity, coachSummary: null })
    })));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('offers the fields on a race and shows the unit for the certified distance', async () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: en.browse.officialResultTitle }));

    expect(screen.getByLabelText(`${en.browse.chipTimeLabel} h`)).toBeDefined();
    expect(screen.getByLabelText(`${en.browse.chipTimeLabel} min`)).toBeDefined();
    expect(screen.getByLabelText(`${en.browse.chipTimeLabel} s`)).toBeDefined();
    expect(screen.getByLabelText(en.browse.certifiedDistanceLabel)).toBeDefined();
    // The distance field must state its unit inside its own label; "10" alone is meaningless.
    const distanceLabel = screen.getByLabelText(en.browse.certifiedDistanceLabel).closest('label') as HTMLElement;
    expect(within(distanceLabel).getByText('km')).toBeDefined();
  });

  it('snaps the recorded distance to the 10 km benchmark before saving', async () => {
    const onActivityUpdated = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: en.browse.officialResultTitle }));

    expect((screen.getByLabelText(en.browse.certifiedDistanceLabel) as HTMLInputElement).value).toBe('10');

    fireEvent.change(screen.getByLabelText(`${en.browse.chipTimeLabel} min`), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText(`${en.browse.chipTimeLabel} s`), { target: { value: '58' } });
    fireEvent.click(screen.getByRole('button', { name: en.common.save }));

    await waitFor(() => expect(onActivityUpdated).toHaveBeenCalled());
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({
      official_time_seconds: 2758,
      official_distance_meters: 10000,
      official_source: 'chip'
    });
  });

  it('refuses a chip time of zero and infinite minutes', async () => {
    const onActivityUpdated = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: en.browse.officialResultTitle }));

    fireEvent.change(screen.getByLabelText(`${en.browse.chipTimeLabel} min`), { target: { value: '75' } });
    fireEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(screen.getByText(en.browse.officialResultInvalid)).toBeDefined();
    expect(onActivityUpdated).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(`${en.browse.chipTimeLabel} min`), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(`${en.browse.chipTimeLabel} s`), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(onActivityUpdated).not.toHaveBeenCalled();
  });

  it('hides the editor on a non-race run but keeps a stored result editable', () => {
    renderHeader({ run_type: 'easy_base' });
    expect(screen.queryByText(en.browse.officialResultTitle)).toBeNull();

    cleanup();
    renderHeader({ run_type: 'easy_base', official_time_seconds: 2758, official_distance_meters: 10000 });
    expect(screen.getAllByText('45:58').length).toBeGreaterThan(0);
  });

  it('reports the certified distance, time and pace while keeping the trace as raw', () => {
    renderHeader({
      official_time_seconds: 2758,
      official_distance_meters: 10000,
      distance_meters: 9988.84,
      duration_seconds: 2817,
      avg_pace_sec_km: 282,
      steady_pace_sec_km: null
    });

    // 2,758 s over 10,000 m is 4:36/km; the recording said 4:42/km.
    expect(screen.getByText(/4:36\/km/)).toBeDefined();
    expect(screen.getAllByText('45:58').length).toBeGreaterThan(0);
    expect(screen.getByText('10.00')).toBeDefined();

    // Nothing is hidden: the recorded values stay visible as raw.
    expect(screen.getByText(/Raw: 4:42\/km/)).toBeDefined();
    expect(screen.getByText(/Raw: 46:57/)).toBeDefined();
    expect(screen.getByText(/Raw: 9\.99 km/)).toBeDefined();
  });
});
