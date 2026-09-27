import React, { useEffect, useState } from 'react';
import { CloudRain, Cloud, Thermometer, RefreshCw, Droplets, CircleHelp, X } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';

interface ActivityWeatherCardProps {
  activity: {
    workout_lat?: number | null;
    workout_lon?: number | null;
    weather_temperature_c?: number | null;
    weather_humidity_pct?: number | null;
    weather_apparent_temp_c?: number | null;
    weather_pm25_ug_m3?: number | null;
    weather_pm25_source?: 'nea-sg' | 'open-meteo' | null;
    weather_condition?: string | null;
    weather_code?: number | null;
    weather_fetched_at?: string | null;
    weather_source?: string | null;
    avg_temperature?: number | null;
  };
  isRefreshingWeather: boolean;
  onRefreshWeather: () => void;
  readOnly?: boolean;
}

export const ActivityWeatherCard: React.FC<ActivityWeatherCardProps> = ({
  activity,
  isRefreshingWeather,
  onRefreshWeather,
  readOnly = false
}) => {
  const { t, format } = useTranslation();
  const [isPm25InfoOpen, setIsPm25InfoOpen] = useState(false);
  const shareNotice = t.weather.shareNotice;
  const hasStoredTemperature = activity.weather_temperature_c !== undefined && activity.weather_temperature_c !== null;
  // Only an Open-Meteo fetch may present itself as ambient weather. Older rows
  // that stored a temperature before provenance existed stay visibly unverified,
  // which matches the heat-scoring rule in verifiedAmbientTemperature().
  const ambientVerified = hasStoredTemperature && activity.weather_source === 'open-meteo';
  const storedUnverified = hasStoredTemperature && !ambientVerified;
  const pm25Value = activity.weather_pm25_ug_m3;
  const pm25Bands = [
    { limit: 55, label: t.weather.pm25Normal, range: t.weather.pm25RangeNormal },
    { limit: 150, label: t.weather.pm25Elevated, range: t.weather.pm25RangeElevated },
    { limit: 250, label: t.weather.pm25High, range: t.weather.pm25RangeHigh },
    { limit: Number.POSITIVE_INFINITY, label: t.weather.pm25VeryHigh, range: t.weather.pm25RangeVeryHigh }
  ];
  const pm25Level = activity.weather_pm25_source === 'nea-sg' && activity.weather_pm25_ug_m3 != null
    ? pm25Bands.find(band => activity.weather_pm25_ug_m3! <= band.limit)?.label ?? null
    : null;
  const isNeaPm25 = activity.weather_pm25_source === 'nea-sg';
  const pm25Explanation = isNeaPm25 ? t.weather.pm25NeaExplanation : t.weather.pm25ModelExplanation;
  const weatherCondition = activity.weather_condition && activity.weather_code != null
    ? t.weather.conditions[String(activity.weather_code)] ?? activity.weather_condition
    : activity.weather_condition;

  useEffect(() => {
    if (!isPm25InfoOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPm25InfoOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isPm25InfoOpen]);

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
          {weatherCondition && (
            <span className="weather-cond">{weatherCondition}</span>
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
          {activity.weather_pm25_ug_m3 != null && (
            <span className="weather-pm25-group">
              <span className="weather-pm25">
                {format(t.weather.pm25, { value: activity.weather_pm25_ug_m3 })}
                {pm25Level && <span className="weather-pm25-level">{pm25Level}</span>}
              </span>
              <button
                type="button"
                className="weather-help-btn"
                aria-label={t.weather.pm25InfoTitle}
                aria-haspopup="dialog"
                aria-expanded={isPm25InfoOpen}
                onClick={() => setIsPm25InfoOpen(true)}
              >
                <CircleHelp size={14} aria-hidden="true" />
              </button>
            </span>
          )}
          {activity.avg_temperature && (
            <span className="weather-watch-sensor" title={t.weather.watchSensor}>
              {format(t.weather.garminSensor, { temperature: activity.avg_temperature ?? '—' })}
            </span>
          )}
          {!readOnly && <button
            className="weather-refresh-btn"
            onClick={onRefreshWeather}
            disabled={isRefreshingWeather}
            title={t.weather.refresh}
            aria-label={t.weather.refresh}
          >
            <RefreshCw size={12} className={isRefreshingWeather ? 'spinning' : ''} />
          </button>}
        </div>
      ) : storedUnverified ? (
        <div className="weather-chip" title={t.weather.unknownSourceTooltip}>
          <Thermometer size={14} />
          <span>{format(t.weather.storedUnverifiedTemp, { temperature: activity.weather_temperature_c ?? '—' })}</span>
          {!readOnly && activity.workout_lat && activity.workout_lon ? (
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
          <Cloud size={18} style={{ color: '#38bdf8' }} />
          <span>{t.weather.available}</span>
          {!readOnly && <button
            className="weather-fetch-btn"
            onClick={onRefreshWeather}
            disabled={isRefreshingWeather}
            title={shareNotice}
          >
            <RefreshCw size={16} className={isRefreshingWeather ? 'spinning' : ''} />
            {isRefreshingWeather ? t.weather.fetching : t.weather.fetch}
          </button>}
          <span className="weather-watch-sensor">{shareNotice}</span>
        </div>
      ) : activity.avg_temperature ? (
        <div className="weather-chip">
          <Thermometer size={14} />
          <span title={t.weather.watchSensor}>{format(t.weather.garminSensor, { temperature: activity.avg_temperature ?? '—' })}</span>
        </div>
      ) : null}
      {isPm25InfoOpen && (
        <div className="modal-overlay weather-pm25-overlay" onClick={() => setIsPm25InfoOpen(false)}>
          <div
            className="modal-content weather-pm25-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="weather-pm25-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="weather-pm25-title" className="modal-title" style={{ color: 'var(--text-primary)' }}>
                {t.weather.pm25InfoTitle}
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsPm25InfoOpen(false)}
                aria-label={t.common.close}
              >
                <X size={20} />
              </button>
            </div>
            <div className="weather-pm25-guide-body">
              <div className="weather-pm25-current-reading">
                <span>{t.weather.pm25CurrentReading}</span>
                <strong>{pm25Value != null ? format(t.weather.pm25, { value: pm25Value }) : '—'}</strong>
                <span className="weather-pm25-source-label">
                  {isNeaPm25 ? t.weather.pm25MeasuredSource : t.weather.pm25ModeledSource}
                </span>
              </div>
              <p className="weather-pm25-help-copy">{pm25Explanation}</p>
              {isNeaPm25 && (
                <section className="weather-pm25-bands" aria-labelledby="weather-pm25-bands-title">
                  <h3 id="weather-pm25-bands-title">{t.weather.pm25BandTitle}</h3>
                  <div>
                    {pm25Bands.map(band => (
                      <div key={band.label} className={`weather-pm25-band-row${band.label === pm25Level ? ' is-current' : ''}`}>
                        <span>{band.label}</span>
                        <span>{band.range}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
