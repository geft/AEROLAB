import { WMO_CODES } from '../../shared/weather-conditions.js';
import type Database from 'better-sqlite3';

export interface WeatherData {
  temperatureC: number | null;
  humidityPct: number | null;
  apparentTempC: number | null;
  pm25: number | null;
  pm25Source: 'nea-sg' | 'open-meteo' | null;
  weatherCode: number | null;
  conditionText: string | null;
}

/** Older rows without a source remain unknown rather than inferred as ambient. */
export function verifiedAmbientTemperature(activity: { weather_source?: string | null; weather_temperature_c?: number | null }): number | null {
  return activity.weather_source === 'open-meteo' ? activity.weather_temperature_c ?? null : null;
}



function emptyWeather(): WeatherData {
  return { temperatureC: null, humidityPct: null, apparentTempC: null, pm25: null, pm25Source: null, weatherCode: null, conditionText: null };
}

function midpointLocalTime(dateStr: string, durationSeconds: number): { date: string; hour: number; datetime: string } | null {
  // Activity start_time is normally stored as the device's local wall time.
  // Explicit-offset timestamps are converted to the machine's local time, as
  // the Open-Meteo timezone=auto response is local to the run coordinates.
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(dateStr)) {
    const instant = new Date(dateStr);
    if (!Number.isFinite(instant.getTime())) return null;
    instant.setTime(instant.getTime() + Math.max(0, durationSeconds) * 500);
    const date = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
    const hour = instant.getHours();
    const datetime = `${date}T${String(hour).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}:${String(instant.getSeconds()).padStart(2, '0')}`;
    return { date, hour, datetime };
  }
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds = '0'] = match;
  const wallTime = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)) + Math.max(0, durationSeconds) * 500);
  if (!Number.isFinite(wallTime.getTime())) return null;
  const date = wallTime.toISOString().slice(0, 10);
  const hour = wallTime.getUTCHours();
  const datetime = `${date}T${String(hour).padStart(2, '0')}:${String(wallTime.getUTCMinutes()).padStart(2, '0')}:${String(wallTime.getUTCSeconds()).padStart(2, '0')}`;
  return { date, hour, datetime };
}

const SINGAPORE_REGIONS = [
  { name: 'central', lat: 1.35735, lon: 103.82 },
  { name: 'east', lat: 1.35735, lon: 103.94 },
  { name: 'north', lat: 1.41803, lon: 103.82 },
  { name: 'south', lat: 1.29587, lon: 103.82 },
  { name: 'west', lat: 1.35735, lon: 103.7 }
] as const;

function isSingaporeCoordinate(lat: number, lon: number): boolean {
  return lat >= 1.15 && lat <= 1.5 && lon >= 103.55 && lon <= 104.1;
}

function nearestSingaporeRegion(lat: number, lon: number): typeof SINGAPORE_REGIONS[number]['name'] {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  return [...SINGAPORE_REGIONS].sort((a, b) => {
    const distance = (region: typeof a) => {
      const latDistance = toRadians(region.lat - lat);
      const lonDistance = toRadians(region.lon - lon) * Math.cos(toRadians(lat));
      return latDistance * latDistance + lonDistance * lonDistance;
    };
    return distance(a) - distance(b);
  })[0].name;
}

async function fetchSingaporeNeaPm25(lat: number, lon: number, datetime: string): Promise<number | null> {
  const url = `https://api-open.data.gov.sg/v2/real-time/api/pm25?date=${encodeURIComponent(datetime)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json() as any;
    const reading = data?.data?.items?.[0]?.readings?.pm25_one_hourly?.[nearestSingaporeRegion(lat, lon)];
    return typeof reading === 'number' && Number.isFinite(reading) ? reading : null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchModeledPm25(lat: number, lon: number, date: string, hour: number): Promise<number | null> {
  const hourText = String(hour).padStart(2, '0');
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=pm2_5&start_hour=${date}T${hourText}:00&end_hour=${date}T${hourText}:00&timezone=auto`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json() as any;
    const value = data?.hourly?.pm2_5?.[0];
    return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(1)) : null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches historical weather for a run using Open-Meteo (100% free, no API key needed).
 * Falls back gracefully to null if offline or rate-limited.
 */
export async function fetchHistoricalWeather(
  lat: number | null,
  lon: number | null,
  dateStr: string,
  durationSeconds = 0
): Promise<WeatherData> {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return emptyWeather();

  try {
    const midpoint = midpointLocalTime(dateStr, durationSeconds);
    if (!midpoint) return emptyWeather();
    const { date: yyyyMmDd, hour } = midpoint;

    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start_date=${yyyyMmDd}&end_date=${yyyyMmDd}&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code&timezone=auto`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s timeout
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      return emptyWeather();
    }

    const data = (await res.json()) as any;
    if (!data?.hourly?.time || data.hourly.time.length === 0) {
      return emptyWeather();
    }

    const targetHourStr = `${yyyyMmDd}T${String(hour).padStart(2, '0')}:00`;
    let hourIdx = data.hourly.time.findIndex((t: string) => t.startsWith(targetHourStr));
    if (hourIdx === -1) hourIdx = Math.min(hour, data.hourly.time.length - 1);

    const temp = data.hourly.temperature_2m?.[hourIdx] ?? null;
    const humidity = data.hourly.relative_humidity_2m?.[hourIdx] ?? null;
    const apparent = data.hourly.apparent_temperature?.[hourIdx] ?? null;
    const code = data.hourly.weather_code?.[hourIdx] ?? null;
    const condition = code !== null ? (WMO_CODES[code] || 'Fair') : null;

    let pm25: number | null = null;
    let pm25Source: WeatherData['pm25Source'] = null;
    if (isSingaporeCoordinate(lat, lon)) {
      try {
        pm25 = await fetchSingaporeNeaPm25(lat, lon, midpoint.datetime);
        if (pm25 !== null) pm25Source = 'nea-sg';
      } catch { /* Fall back to the global model if NEA is unavailable. */ }
    }
    if (pm25 === null) {
      try {
        pm25 = await fetchModeledPm25(lat, lon, yyyyMmDd, hour);
        if (pm25 !== null) pm25Source = 'open-meteo';
      } catch { /* Air quality is an optional enrichment. */ }
    }

    return {
      temperatureC: temp !== null ? Number(temp.toFixed(1)) : null,
      humidityPct: humidity !== null ? Math.round(humidity) : null,
      apparentTempC: apparent !== null ? Number(apparent.toFixed(1)) : null,
      pm25,
      pm25Source,
      weatherCode: code,
      conditionText: condition
    };
  } catch {
    // Network offline or timeout - return nulls without failing
    return emptyWeather();
  }
}

/**
 * Fetches and persists historical microclimate weather for a specific activity into the activities table.
 */
export async function syncActivityWeather(db: Database.Database, activityId: string, onPersist?: () => void): Promise<WeatherData | null> {
  const act = db.prepare('SELECT id, workout_lat, workout_lon, start_time, duration_seconds, elapsed_seconds FROM activities WHERE id = ?').get(activityId) as {
    id: string; workout_lat: number | null; workout_lon: number | null; start_time: string; duration_seconds: number | null; elapsed_seconds: number | null;
  } | undefined;
  if (!act || act.workout_lat === null || act.workout_lon === null) {
    return null;
  }

  const runElapsedSeconds = act.elapsed_seconds ?? act.duration_seconds ?? 0;
  const weather = await fetchHistoricalWeather(act.workout_lat, act.workout_lon, act.start_time, runElapsedSeconds);
  if (weather.temperatureC !== null || weather.conditionText !== null || weather.pm25 !== null) {
    db.transaction(() => {
      db.prepare(`
        UPDATE activities SET
          weather_temperature_c = ?,
          weather_humidity_pct = ?,
          weather_apparent_temp_c = ?,
          weather_pm25_ug_m3 = ?,
          weather_pm25_source = ?,
          weather_condition = ?,
          weather_code = ?,
          weather_fetched_at = CURRENT_TIMESTAMP,
          weather_source = 'open-meteo'
        WHERE id = ?
      `).run(
        weather.temperatureC,
        weather.humidityPct,
        weather.apparentTempC,
        weather.pm25,
        weather.pm25Source,
        weather.conditionText,
        weather.weatherCode,
        activityId
      );
      onPersist?.();
    })();
  }

  return weather;
}
