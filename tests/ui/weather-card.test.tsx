// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ActivityWeatherCard } from '../../src/frontend/components/browse/ActivityWeatherCard.js';
import { LanguageProvider } from '../../src/frontend/i18n/LanguageContext.js';

type CardActivity = React.ComponentProps<typeof ActivityWeatherCard>['activity'];

function renderCard(activity: CardActivity) {
  const { container } = render(
    <LanguageProvider>
      <ActivityWeatherCard activity={activity} isRefreshingWeather={false} onRefreshWeather={vi.fn()} />
    </LanguageProvider>
  );
  return container;
}

// The four provenance combinations the audit calls out: device-only,
// ambient-only, both, and neither. A stored temperature without a verified
// source must never be presented as ambient weather.
describe('ActivityWeatherCard provenance states', () => {
  afterEach(cleanup);

  it('labels a fetched reading as ambient weather and not as a device sensor', () => {
    const container = renderCard({
      workout_lat: 1.3521,
      workout_lon: 103.8198,
      weather_source: 'open-meteo',
      weather_temperature_c: 31,
      weather_humidity_pct: 74,
      weather_condition: 'Fair',
      weather_fetched_at: '2026-09-01 07:00:00'
    });

    expect(container.querySelector('.weather-chip-ambient')).toBeTruthy();
    expect(container.textContent).toContain('31°C');
    expect(container.textContent).not.toContain('Garmin sensor');
  });

  it('shows the device sensor reading on its own when no ambient lookup exists', () => {
    const container = renderCard({ avg_temperature: 28 });

    expect(container.querySelector('.weather-chip-ambient')).toBeNull();
    expect(container.textContent).toContain('Garmin sensor: 28°C');
  });

  it('shows both readings side by side without merging them', () => {
    const container = renderCard({
      workout_lat: 1.3521,
      workout_lon: 103.8198,
      weather_source: 'open-meteo',
      weather_temperature_c: 31,
      avg_temperature: 28
    });

    expect(container.querySelector('.weather-chip-ambient')).toBeTruthy();
    expect(container.textContent).toContain('31°C');
    expect(container.textContent).toContain('Garmin sensor: 28°C');
  });

  it('explains PM2.5 with a help control and displays the NEA hourly band', () => {
    const container = renderCard({
      weather_source: 'open-meteo',
      weather_temperature_c: 30.2,
      weather_pm25_ug_m3: 96,
      weather_pm25_source: 'nea-sg'
    });

    expect(container.textContent).toContain('PM2.5 96 µg/m³');
    expect(container.textContent).toContain('Elevated');
    const help = container.querySelector('.weather-help-btn');
    expect(help?.getAttribute('aria-label')).toContain('Measured 1-hour PM2.5');
    expect(help?.getAttribute('title')).toContain('56–150 Elevated');
  });

  it('offers the opt-in lookup when the workout has coordinates but no reading', () => {
    const container = renderCard({ workout_lat: 1.3521, workout_lon: 103.8198 });

    expect(container.textContent).toContain('Weather available');
    expect(container.textContent).toContain('Get weather');
  });

  it('keeps a stored temperature without provenance out of the ambient state', () => {
    const container = renderCard({ workout_lat: 1.3521, workout_lon: 103.8198, weather_temperature_c: 31 });

    expect(container.querySelector('.weather-chip-ambient')).toBeNull();
    expect(container.textContent).toContain('Stored temperature: 31°C (source unverified)');
    expect(container.querySelector('.weather-refresh-btn')).toBeTruthy();
  });

  it('renders no chip when there is neither a reading nor a location', () => {
    const container = renderCard({});

    expect(container.querySelectorAll('.weather-chip')).toHaveLength(0);
    expect(container.textContent).toBe('');
  });
});
