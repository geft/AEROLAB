import React from 'react';
import { CloudRain, Cloud, Thermometer, RefreshCw, Droplets } from 'lucide-react';

interface ActivityWeatherCardProps {
  activity: {
    workout_lat?: number | null;
    workout_lon?: number | null;
    weather_temperature_c?: number | null;
    weather_humidity_pct?: number | null;
    weather_apparent_temp_c?: number | null;
    weather_condition?: string | null;
    weather_code?: number | null;
    weather_fetched_at?: string | null;
    avg_temperature?: number | null;
  };
  isRefreshingWeather: boolean;
  onRefreshWeather: () => void;
}

export const ActivityWeatherCard: React.FC<ActivityWeatherCardProps> = ({
  activity,
  isRefreshingWeather,
  onRefreshWeather
}) => {
  return (
    <div className="weather-chip-group">
      {activity.weather_temperature_c !== undefined && activity.weather_temperature_c !== null ? (
        <div
          className="weather-chip weather-chip-ambient"
          title={`Historical microclimate weather via Open-Meteo for workout GPS location (${activity.workout_lat?.toFixed(3) ?? '—'}, ${activity.workout_lon?.toFixed(3) ?? '—'}). Fetched: ${activity.weather_fetched_at || 'Recently'}`}
        >
          <CloudRain size={14} style={{ color: '#38bdf8' }} />
          <span className="weather-temp-main">{activity.weather_temperature_c}°C</span>
          {activity.weather_condition && (
            <span className="weather-cond">{activity.weather_condition}</span>
          )}
          {activity.weather_humidity_pct !== null && (
            <span className="weather-metric" title="Relative Humidity">
              <Droplets size={11} /> {activity.weather_humidity_pct}%
            </span>
          )}
          {activity.weather_apparent_temp_c !== null && (
            <span className="weather-metric" title="Apparent Temperature (Feels like)">
              Feels {activity.weather_apparent_temp_c}°C
            </span>
          )}
          {activity.avg_temperature && (
            <span className="weather-watch-sensor" title="On-wrist Garmin optical/device sensor (elevated by skin heat)">
              Watch: {activity.avg_temperature}°C
            </span>
          )}
          <button
            className="weather-refresh-btn"
            onClick={onRefreshWeather}
            disabled={isRefreshingWeather}
            title="Re-fetch microclimate weather from Open-Meteo"
            aria-label="Refresh weather"
          >
            <RefreshCw size={12} className={isRefreshingWeather ? 'spinning' : ''} />
          </button>
        </div>
      ) : activity.workout_lat && activity.workout_lon ? (
        <div className="weather-chip weather-chip-ambient">
          <Cloud size={14} style={{ color: '#38bdf8' }} />
          <span>Microclimate weather available</span>
          <button
            className="weather-fetch-btn"
            onClick={onRefreshWeather}
            disabled={isRefreshingWeather}
          >
            <RefreshCw size={12} className={isRefreshingWeather ? 'spinning' : ''} />
            {isRefreshingWeather ? 'Fetching...' : 'Fetch Weather'}
          </button>
        </div>
      ) : activity.avg_temperature ? (
        <div className="weather-chip">
          <Thermometer size={14} />
          <span>Garmin Sensor: {activity.avg_temperature}°C</span>
        </div>
      ) : null}
    </div>
  );
};
