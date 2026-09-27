// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ActivityWeatherCard } from '../../src/frontend/components/browse/ActivityWeatherCard.js';
import { LanguageProvider } from '../../src/frontend/i18n/LanguageContext.js';
import { useTranslation } from '../../src/frontend/i18n/LanguageContext.js';

type CardActivity = React.ComponentProps<typeof ActivityWeatherCard>['activity'];

function LanguageSetter({ language, children }: { language: 'en' | 'zh'; children: React.ReactNode }) {
  const { setLanguage } = useTranslation();
  useEffect(() => setLanguage(language), [language, setLanguage]);
  return <>{children}</>;
}

function renderCard(activity: CardActivity, language: 'en' | 'zh' = 'en') {
  const { container } = render(
    <LanguageProvider>
      <LanguageSetter language={language}>
        <ActivityWeatherCard activity={activity} isRefreshingWeather={false} onRefreshWeather={vi.fn()} />
      </LanguageSetter>
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

  it('opens a PM2.5 explanation popup and keeps its help control beside the reading', () => {
    const { container, getByRole, queryByRole } = render(
      <LanguageProvider>
        <ActivityWeatherCard
          activity={{
            weather_source: 'open-meteo',
            weather_temperature_c: 30.2,
            weather_pm25_ug_m3: 96,
            weather_pm25_source: 'nea-sg'
          }}
          isRefreshingWeather={false}
          onRefreshWeather={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(container.textContent).toContain('PM2.5 96 µg/m³');
    expect(container.textContent).toContain('Elevated');
    expect(container.querySelector('.weather-pm25-group')?.contains(container.querySelector('.weather-help-btn'))).toBe(true);
    expect(queryByRole('dialog')).toBeNull();

    fireEvent.click(getByRole('button', { name: 'About PM2.5' }));

    const dialog = getByRole('dialog');
    expect(dialog.textContent).toContain('Measured · NEA regional monitor');
    expect(dialog.textContent).toContain('Singapore NEA 1-hour bands');
    expect(dialog.textContent).toContain('56–150 µg/m³');
    fireEvent.click(getByRole('button', { name: 'Close' }));
    expect(queryByRole('dialog')).toBeNull();
  });

  it('labels outside-Singapore PM2.5 as a model estimate without NEA bands', () => {
    const { getByRole, queryByText } = render(
      <LanguageProvider>
        <ActivityWeatherCard
          activity={{
            weather_source: 'open-meteo',
            weather_temperature_c: 18,
            weather_pm25_ug_m3: 8.4,
            weather_pm25_source: 'open-meteo'
          }}
          isRefreshingWeather={false}
          onRefreshWeather={vi.fn()}
        />
      </LanguageProvider>
    );

    fireEvent.click(getByRole('button', { name: 'About PM2.5' }));

    const dialog = getByRole('dialog');
    expect(dialog.textContent).toContain('Model estimate · Open-Meteo');
    expect(dialog.textContent).toContain('rather than a local monitor reading');
    expect(queryByText('Singapore NEA 1-hour bands')).toBeNull();
    expect(dialog.textContent).not.toContain('NEA regional monitor');
  });

  it('localizes known weather conditions in Chinese mode', () => {
    const container = renderCard({
      workout_lat: 1.3521,
      workout_lon: 103.8198,
      weather_source: 'open-meteo',
      weather_temperature_c: 30,
      weather_condition: 'Mainly clear',
      weather_code: 1
    }, 'zh');

    expect(container.textContent).toContain('大致晴朗');
    expect(container.textContent).not.toContain('Mainly clear');
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
