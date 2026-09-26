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
    expect(res.pm25).toBeNull();
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

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [{ readings: { pm25_one_hourly: { central: 96, north: 46, south: 54, east: 76, west: 48 } } }],
            regionMetadata: [
              { name: 'central', labelLocation: { latitude: 1.35735, longitude: 103.82 } },
              { name: 'north', labelLocation: { latitude: 1.41803, longitude: 103.82 } }
            ]
          }
        })
      } as any);

    const res = await fetchHistoricalWeather(1.3521, 103.8512, '2026-09-12T07:15:00', 7200);
    expect(res.temperatureC).toBe(28.2);
    expect(res.humidityPct).toBe(78);
    expect(res.apparentTempC).toBe(33.5);
    expect(res.weatherCode).toBe(2);
    expect(res.conditionText).toBe('Partly cloudy');
    expect(res.pm25).toBe(96);
    expect(res.pm25Source).toBe('nea-sg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('start_date=2026-09-12');
    expect(String(fetchMock.mock.calls[1][0])).toContain('date=2026-09-12T08%3A15%3A00');
    expect(String(fetchMock.mock.calls[1][0])).toContain('api-open.data.gov.sg/v2/real-time/api/pm25');
  });

  it('uses the midpoint wall time across midnight and tolerates an air-quality failure', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hourly: {
            time: ['2026-09-13T00:00', '2026-09-13T01:00'],
            temperature_2m: [27, 26],
            relative_humidity_2m: [80, 82],
            apparent_temperature: [30, 29],
            weather_code: [71, 73]
          }
        })
      } as any)
      .mockRejectedValueOnce(new Error('NEA unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hourly: { pm2_5: [42.56] } })
      } as any);

    const res = await fetchHistoricalWeather(1.35, 103.85, '2026-09-12 23:30:00', 7200);

    expect(String(fetchMock.mock.calls[0][0])).toContain('start_date=2026-09-13');
    expect(res.temperatureC).toBe(27);
    expect(res.conditionText).toBe('Slight snow');
    expect(res.pm25).toBe(42.6);
    expect(res.pm25Source).toBe('open-meteo');
    expect(String(fetchMock.mock.calls[2][0])).toContain('air-quality-api.open-meteo.com');
  });

  it('does not query Singapore haze data for locations outside Singapore', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hourly: {
            time: ['2026-09-12T07:00'],
            temperature_2m: [18],
            relative_humidity_2m: [55],
            apparent_temperature: [18],
            weather_code: [1]
          }
        })
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ hourly: { pm2_5: [8.4] } })
      } as any);

    const res = await fetchHistoricalWeather(37.7749, -122.4194, '2026-09-12T07:00:00Z', 3600);

    expect(res.pm25).toBe(8.4);
    expect(res.pm25Source).toBe('open-meteo');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('air-quality-api.open-meteo.com');
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('api-open.data.gov.sg');
  });

});
