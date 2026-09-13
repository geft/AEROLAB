export interface WeatherData {
  temperatureC: number | null;
  humidityPct: number | null;
  apparentTempC: number | null;
  weatherCode: number | null;
  conditionText: string | null;
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
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail'
};

/**
 * Fetches historical weather for a run using Open-Meteo (100% free, no API key needed).
 * Falls back gracefully to null if offline or rate-limited.
 */
export async function fetchHistoricalWeather(
  lat: number | null,
  lon: number | null,
  dateStr: string
): Promise<WeatherData> {
  if (!lat || !lon) {
    return { temperatureC: null, humidityPct: null, apparentTempC: null, weatherCode: null, conditionText: null };
  }

  try {
    const runDate = new Date(dateStr);
    if (isNaN(runDate.getTime())) {
      return { temperatureC: null, humidityPct: null, apparentTempC: null, weatherCode: null, conditionText: null };
    }

    const yyyyMmDd = runDate.toISOString().split('T')[0];
    const hour = runDate.getHours();

    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start_date=${yyyyMmDd}&end_date=${yyyyMmDd}&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code&timezone=auto`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s timeout

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return { temperatureC: null, humidityPct: null, apparentTempC: null, weatherCode: null, conditionText: null };
    }

    const data = (await res.json()) as any;
    if (!data?.hourly?.time || data.hourly.time.length === 0) {
      return { temperatureC: null, humidityPct: null, apparentTempC: null, weatherCode: null, conditionText: null };
    }

    const targetHourStr = `${yyyyMmDd}T${String(hour).padStart(2, '0')}:00`;
    let hourIdx = data.hourly.time.findIndex((t: string) => t.startsWith(targetHourStr));
    if (hourIdx === -1) hourIdx = Math.min(hour, data.hourly.time.length - 1);

    const temp = data.hourly.temperature_2m?.[hourIdx] ?? null;
    const humidity = data.hourly.relative_humidity_2m?.[hourIdx] ?? null;
    const apparent = data.hourly.apparent_temperature?.[hourIdx] ?? null;
    const code = data.hourly.weather_code?.[hourIdx] ?? null;
    const condition = code !== null ? (WMO_CODES[code] || 'Fair') : null;

    return {
      temperatureC: temp !== null ? Number(temp.toFixed(1)) : null,
      humidityPct: humidity !== null ? Math.round(humidity) : null,
      apparentTempC: apparent !== null ? Number(apparent.toFixed(1)) : null,
      weatherCode: code,
      conditionText: condition
    };
  } catch {
    // Network offline or timeout - return nulls without failing
    return { temperatureC: null, humidityPct: null, apparentTempC: null, weatherCode: null, conditionText: null };
  }
}

/**
 * Fetches and persists historical microclimate weather for a specific activity into the activities table.
 */
export async function syncActivityWeather(db: any, activityId: string): Promise<WeatherData | null> {
  const act = db.prepare('SELECT id, workout_lat, workout_lon, start_time FROM activities WHERE id = ?').get(activityId) as any;
  if (!act || act.workout_lat === null || act.workout_lon === null) {
    return null;
  }

  const weather = await fetchHistoricalWeather(act.workout_lat, act.workout_lon, act.start_time);
  if (weather.temperatureC !== null || weather.conditionText !== null) {
    try {
      db.prepare(`
        UPDATE activities SET
          weather_temperature_c = ?,
          weather_humidity_pct = ?,
          weather_apparent_temp_c = ?,
          weather_condition = ?,
          weather_code = ?,
          weather_fetched_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        weather.temperatureC,
        weather.humidityPct,
        weather.apparentTempC,
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

/**
 * Automatically backfills historical microclimate weather for any activity missing weather data.
 */
export async function syncAllActivitiesWeather(db: any): Promise<number> {
  try {
    const unbackfilled = db.prepare(`
      SELECT id FROM activities 
      WHERE workout_lat IS NOT NULL 
        AND workout_lon IS NOT NULL 
        AND weather_temperature_c IS NULL
    `).all() as Array<{ id: string }>;

    let count = 0;
    for (const act of unbackfilled) {
      const res = await syncActivityWeather(db, act.id);
      if (res && res.temperatureC !== null) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}
