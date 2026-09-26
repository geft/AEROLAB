export interface WeatherData {
  temperatureC: number | null;
  humidityPct: number | null;
  apparentTempC: number | null;
  pm25: number | null;
  weatherCode: number | null;
  conditionText: string | null;
}

/** Older rows without a source remain unknown rather than inferred as ambient. */
export function verifiedAmbientTemperature(activity: { weather_source?: string | null; weather_temperature_c?: number | null }): number | null {
  return activity.weather_source === 'open-meteo' ? activity.weather_temperature_c ?? null : null;
}

const WMO_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail'
};

function emptyWeather(): WeatherData {
  return { temperatureC: null, humidityPct: null, apparentTempC: null, pm25: null, weatherCode: null, conditionText: null };
}

function midpointLocalTime(dateStr: string, durationSeconds: number): { date: string; hour: number } | null {
  // Activity start_time is normally stored as the device's local wall time.
  // Explicit-offset timestamps are converted to the machine's local time, as
  // the Open-Meteo timezone=auto response is local to the run coordinates.
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(dateStr)) {
    const instant = new Date(dateStr);
    if (!Number.isFinite(instant.getTime())) return null;
    instant.setTime(instant.getTime() + Math.max(0, durationSeconds) * 500);
    const date = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`;
    return { date, hour: instant.getHours() };
  }
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds = '0'] = match;
  const wallTime = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)) + Math.max(0, durationSeconds) * 500);
  if (!Number.isFinite(wallTime.getTime())) return null;
  return { date: wallTime.toISOString().slice(0, 10), hour: wallTime.getUTCHours() };
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

    // Open-Meteo's air quality archive is separate from the weather archive.
    // Keep it optional so an AQ outage never hides otherwise valid weather.
    let pm25: number | null = null;
    try {
      const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=pm2_5&start_hour=${yyyyMmDd}T${String(hour).padStart(2, '0')}:00&end_hour=${yyyyMmDd}T${String(hour).padStart(2, '0')}:00&timezone=auto`;
      const airController = new AbortController();
      const airTimeoutId = setTimeout(() => airController.abort(), 3500);
      const airRes = await fetch(airUrl, { signal: airController.signal }).finally(() => clearTimeout(airTimeoutId));
      if (airRes.ok) {
        const airData = await airRes.json() as any;
        const rawPm25 = airData?.hourly?.pm2_5?.[0];
        if (typeof rawPm25 === 'number' && Number.isFinite(rawPm25)) pm25 = Number(rawPm25.toFixed(1));
      }
    } catch { /* Air quality is an optional enrichment. */ }

    return {
      temperatureC: temp !== null ? Number(temp.toFixed(1)) : null,
      humidityPct: humidity !== null ? Math.round(humidity) : null,
      apparentTempC: apparent !== null ? Number(apparent.toFixed(1)) : null,
      pm25,
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
export async function syncActivityWeather(db: any, activityId: string): Promise<WeatherData | null> {
  const act = db.prepare('SELECT id, workout_lat, workout_lon, start_time, duration_seconds, elapsed_seconds FROM activities WHERE id = ?').get(activityId) as any;
  if (!act || act.workout_lat === null || act.workout_lon === null) {
    return null;
  }

  const runElapsedSeconds = act.elapsed_seconds ?? act.duration_seconds ?? 0;
  const weather = await fetchHistoricalWeather(act.workout_lat, act.workout_lon, act.start_time, runElapsedSeconds);
  if (weather.temperatureC !== null || weather.conditionText !== null || weather.pm25 !== null) {
    try {
      db.prepare(`
        UPDATE activities SET
          weather_temperature_c = ?,
          weather_humidity_pct = ?,
          weather_apparent_temp_c = ?,
          weather_pm25_ug_m3 = ?,
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
        weather.conditionText,
        weather.weatherCode,
        activityId
      );
    } catch (err) {
      // Non-fatal if table columns not ready
    }
  }

  return weather;
}
