import React from 'react';
import { CloudRain, Cloud, Thermometer, RefreshCw, Droplets } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';

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
    weather_source?: string | null;
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
  const { t, format } = useTranslation();
  const shareNotice = t.weather.shareNotice;
  const hasStoredTemperature = activity.weather_temperature_c !== undefined && activity.weather_temperature_c !== null;
  // Only an Open-Meteo fetch may present itself as ambient weather. Older rows
  // that stored a temperature before provenance existed stay visibly unverified,
  // which matches the heat-scoring rule in verifiedAmbientTemperature().
  const ambientVerified = hasStoredTemperature && activity.weather_source === 'open-meteo';
  const storedUnverified = hasStoredTemperature && !ambientVerified;
  return (
    <div className="weather-chip-group">
      {ambientVerified ? (
        <div
          className="weather-chip weather-chip-ambient"
          title={format(t.weather.ambientTooltip, {
            lat: activity.workout_lat?.toFixed(3) ?? '—',
            lon: activity.workout_lon?.toFixed(3) ?? '—',
            fetched: activity.weather_fetched_at ?? '—'
          })}
        >
          <CloudRain size={14} style={{ color: '#38bdf8' }} />
          <span className="weather-temp-main">{activity.weather_temperature_c}°C</span>
          {activity.weather_condition && (
            <span className="weather-cond">{activity.weather_condition}</span>
          )}
          {activity.weather_humidity_pct !== null && (
            <span className="weather-metric" title={t.weather.humidity}>
              <Droplets size={11} /> {activity.weather_humidity_pct}%
            </span>
          )}
          {activity.weather_apparent_temp_c !== null && (
            <span className="weather-metric">
              {format(t.weather.feelsLike, { temperature: activity.weather_apparent_temp_c ?? '—' })}
            </span>
          )}
          {activity.avg_temperature && (
            <span className="weather-watch-sensor" title={t.weather.watchSensor}>
              {format(t.weather.garminSensor, { temperature: activity.avg_temperature ?? '—' })}
            </span>
          )}
          <button
            className="weather-refresh-btn"
            onClick={onRefreshWeather}
            disabled={isRefreshingWeather}
            title={t.weather.refresh}
            aria-label={t.weather.refresh}
          >
            <RefreshCw size={12} className={isRefreshingWeather ? 'spinning' : ''} />
          </button>
        </div>
      ) : storedUnverified ? (
        <div className="weather-chip" title={t.weather.unknownSourceTooltip}>
          <Thermometer size={14} />
          <span>{format(t.weather.storedUnverifiedTemp, { temperature: activity.weather_temperature_c ?? '—' })}</span>
          {activity.workout_lat && activity.workout_lon ? (
            <button
              className="weather-refresh-btn"
              onClick={onRefreshWeather}
              disabled={isRefreshingWeather}
              title={t.weather.refresh}
              aria-label={t.weather.refresh}
            >
              <RefreshCw size={12} className={isRefreshingWeather ? 'spinning' : ''} />
            </button>
          ) : null}
        </div>
      ) : activity.workout_lat && activity.workout_lon ? (
        <div className="weather-chip weather-chip-ambient">
          <Cloud size={14} style={{ color: '#38bdf8' }} />
          <span>{t.weather.available}</span>
          <button
            className="weather-fetch-btn"
            onClick={onRefreshWeather}
            disabled={isRefreshingWeather}
            title={shareNotice}
          >
            <RefreshCw size={12} className={isRefreshingWeather ? 'spinning' : ''} />
            {isRefreshingWeather ? t.weather.fetching : t.weather.fetch}
          </button>
          <span className="weather-watch-sensor">{shareNotice}</span>
        </div>
      ) : activity.avg_temperature ? (
        <div className="weather-chip">
          <Thermometer size={14} />
          <span title={t.weather.watchSensor}>{format(t.weather.garminSensor, { temperature: activity.avg_temperature ?? '—' })}</span>
        </div>
      ) : null}
    </div>
  );
};
