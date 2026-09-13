import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchHistoricalWeather } from '../../src/backend/physiology/weather.js';

describe('Weather Service Unit Tests', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns nulls immediately when latitude or longitude are missing', async () => {
    const res = await fetchHistoricalWeather(null, null, '2026-09-12 07:00:00');
    expect(res.temperatureC).toBeNull();
    expect(res.humidityPct).toBeNull();
    expect(res.apparentTempC).toBeNull();
    expect(res.conditionText).toBeNull();
  });

  it('returns nulls when date string is invalid', async () => {
    const res = await fetchHistoricalWeather(1.35, 103.85, 'invalid-date');
    expect(res.temperatureC).toBeNull();
  });

  it('returns nulls gracefully on network error or timeout without crashing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));
    const res = await fetchHistoricalWeather(1.35, 103.85, '2026-09-12T07:00:00Z');
    expect(res.temperatureC).toBeNull();
    expect(res.humidityPct).toBeNull();
  });

  it('correctly maps hourly weather metrics and WMO condition codes on successful response', async () => {
    const testDate = new Date('2026-09-12T07:15:00');
    const yyyyMmDd = testDate.toISOString().split('T')[0];
    const hour = testDate.getHours();
    const targetHourStr = `${yyyyMmDd}T${String(hour).padStart(2, '0')}:00`;

    const mockApiResponse = {
      hourly: {
        time: [targetHourStr],
        temperature_2m: [28.2],
        relative_humidity_2m: [78.4],
        apparent_temperature: [33.5],
        weather_code: [2]
      }
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse
    } as any);

    const res = await fetchHistoricalWeather(1.3521, 103.8512, '2026-09-12T07:15:00');
    expect(res.temperatureC).toBe(28.2);
    expect(res.humidityPct).toBe(78);
    expect(res.apparentTempC).toBe(33.5);
    expect(res.weatherCode).toBe(2);
    expect(res.conditionText).toBe('Partly cloudy');
  });

});
