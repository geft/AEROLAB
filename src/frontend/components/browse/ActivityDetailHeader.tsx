import React, { useState } from 'react';
import type { Activity, ActivityRecord, ActivityUpdate } from '../../types/api.js';

import { getActivityTags } from '../../features/browse/selectors.js';
import type { DisplayTitleFn } from '../../features/browse/selectors.js';
import type { Translations } from '../../i18n/types.js';
import { Edit2, Tag, Download } from 'lucide-react';
import { ActivityWeatherCard } from './ActivityWeatherCard';
import { translateTag } from '../../i18n/tagTranslator';
import { translateActivityName } from '../../i18n/coachTranslator.js';
import { useTranslation } from '../../i18n/LanguageContext';
import { patchActivity } from '../../api/client.js';
import { invalidateActivityData } from '../../features/activity-revision.js';
import { formatDuration } from '../../utils/formatters.js';
import { snapToBenchmark } from '../../../shared/best-efforts.js';
import { downloadSessionCsv } from '../../utils/sessionCsv.js';
import { isTreadmillFitMetadata } from '../../../shared/activity-environment.js';

interface ActivityDetailHeaderProps {
  act: Activity;
  records: ActivityRecord[];
  fitMetadata?: Record<string, unknown> | null;
  getDisplayTitle: DisplayTitleFn;
  formatPace: (secKm: number | null) => string;
  formatTime: (sec: number) => string;
  getTimeOfDay: (dateStr: string) => string;
  onActivityUpdated?: (activity: ActivityUpdate) => void;
  onRefreshWeather: () => void;
  isRefreshingWeather: boolean;
  t: Translations;
  readOnly?: boolean;
}

export const ActivityDetailHeader: React.FC<ActivityDetailHeaderProps> = ({
  act,
  records,
  fitMetadata,
  getDisplayTitle,
  formatPace,
  formatTime,
  getTimeOfDay,
  onActivityUpdated,
  onRefreshWeather,
  isRefreshingWeather,
  t,
  readOnly = false
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [customTitle, setCustomTitle] = useState<string>('');
  const [isEditingOfficial, setIsEditingOfficial] = useState<boolean>(false);
  const [officialHoursInput, setOfficialHoursInput] = useState<string>('');
  const [officialMinutesInput, setOfficialMinutesInput] = useState<string>('');
  const [officialSecondsInput, setOfficialSecondsInput] = useState<string>('');
  const [certifiedDistanceInput, setCertifiedDistanceInput] = useState<string>('');
  const [officialError, setOfficialError] = useState<boolean>(false);
  const { formatDate, language } = useTranslation();
  const displayCadence = act.steady_cadence || act.avg_cadence;
  const isTreadmill = act.is_treadmill || isTreadmillFitMetadata(fitMetadata);

  const currentTags = getActivityTags(act);

  // A stored result must stay editable even if the classifier later re-labels
  // the run, otherwise the PB keeps a value the UI can no longer reach.
  const hasOfficialResult = act.official_time_seconds != null;
  const showOfficialResult = act.run_type === 'race' || hasOfficialResult;

  // The official result defines what the race was: distance, time and pace.
  // Everything else in the header (heart rate, cadence, elevation, load) still
  // comes from the trace, which is what actually recorded how it was run.
  const officialTimeSeconds = act.official_time_seconds ?? null;
  const officialDistanceMeters = act.official_distance_meters ?? null;
  const officialPaceSecKm = officialTimeSeconds != null && officialDistanceMeters
    ? Math.round((officialTimeSeconds / officialDistanceMeters) * 1000)
    : null;

  /** Metres to a compact kilometres string: 10000 -> "10", 21097.5 -> "21.1". */
  const formatKilometres = (metres: number): string =>
    (metres / 1000).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');

  const openOfficialEditor = (): void => {
    const total = act.official_time_seconds;
    if (total != null) {
      setOfficialHoursInput(String(Math.floor(total / 3600)));
      setOfficialMinutesInput(String(Math.floor((total % 3600) / 60)).padStart(2, '0'));
      setOfficialSecondsInput(String(Math.round(total % 60)).padStart(2, '0'));
    } else {
      setOfficialHoursInput('0');
      setOfficialMinutesInput('');
      setOfficialSecondsInput('');
    }
    const metres = act.official_distance_meters
      ?? snapToBenchmark(act.distance_meters)
      ?? act.distance_meters;
    setCertifiedDistanceInput(formatKilometres(metres));
    setOfficialError(false);
    setIsEditingOfficial(true);
  };

  /** Digits only, capped at two, so a stray letter can never reach the parser. */
  const digitsOnly = (value: string): string => value.replace(/\D/g, '').slice(0, 2);

  const saveOfficialResult = async (): Promise<void> => {
    const hours = Number(officialHoursInput || 0);
    const minutes = Number(officialMinutesInput || 0);
    const seconds = Number(officialSecondsInput || 0);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    const timeValid = minutes < 60 && seconds < 60 && totalSeconds > 0;
    const kilometres = Number(certifiedDistanceInput.replace(',', '.'));
    if (!timeValid || !Number.isFinite(kilometres) || kilometres <= 0) {
      setOfficialError(true);
      return;
    }
    try {
      const response = await patchActivity(act.id, {
        official_time_seconds: totalSeconds,
        official_distance_meters: Math.round(kilometres * 1000),
        official_source: 'chip'
      });
      onActivityUpdated?.(response.activity);
      setOfficialError(false);
      setIsEditingOfficial(false);
      // Best efforts and the PB tiles read the official result, so they must refetch.
      invalidateActivityData();
    } catch (err) {
      console.error('Failed to save official result:', err);
      setOfficialError(true);
    }
  };

  const clearOfficialResult = async (): Promise<void> => {
    try {
      const response = await patchActivity(act.id, {
        official_time_seconds: null,
        official_distance_meters: null,
        official_source: null
      });
      onActivityUpdated?.(response.activity);
      setIsEditingOfficial(false);
      invalidateActivityData();
    } catch (err) {
      console.error('Failed to clear official result:', err);
    }
  };

  const officialInputStyle: React.CSSProperties = {
    background: '#172036',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6,
    padding: '0 0.55rem',
    height: '2rem',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
    width: '8.5rem'
  };

  const officialFieldLabelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
    fontSize: '0.65rem',
    color: 'var(--text-secondary)'
  };

  const officialButtonStyle: React.CSSProperties = {
    borderRadius: 6,
    border: 'none',
    height: '2rem',
    padding: '0 0.75rem',
    fontSize: '0.75rem',
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer'
  };

  const officialUnitStyle: React.CSSProperties = {
    fontSize: '0.78rem',
    fontWeight: 600,
    color: 'var(--text-secondary)'
  };

  return (
    <section className="overview-card">
      <div className="overview-top">
        <div className="run-title-group">
          {isEditingTitle ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
              <input
                type="text"
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
                placeholder={t.browse.activityNamePlaceholder}
                style={{
                  background: '#172036',
                  color: '#fff',
                  border: '1px solid #06b6d4',
                  borderRadius: 6,
                  padding: '0.35rem 0.65rem',
                  fontSize: '1.2rem',
                  fontFamily: 'var(--font-heading)',
                  width: '320px'
                }}
              />
              <button
                onClick={async () => {
                  try {
                    await patchActivity(act.id, { name: customTitle });
                    onActivityUpdated?.({ id: act.id, name: customTitle });
                    setIsEditingTitle(false);
                  } catch (err) {
                    console.error('Failed to update title:', err);
                  }
                }}
                style={{ background: '#06b6d4', color: '#07090e', border: 'none', borderRadius: 6, padding: '0.4rem 0.75rem', fontWeight: 600, cursor: 'pointer' }}
              >
                {t.common.save}
              </button>
              {!readOnly && <button
                onClick={() => setIsEditingTitle(false)}
                style={{ background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '0.4rem 0.75rem', cursor: 'pointer' }}
              >
                {t.common.cancel}
              </button>}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
              <h1 style={{ margin: 0 }}>{translateActivityName(getDisplayTitle(act, t), language, t.browse.coachLegacyTemplates)}</h1>
              {isTreadmill && <span className="activity-context-badge">{t.browse.treadmillActivity}</span>}
              {!readOnly && <button
                onClick={() => { setCustomTitle(act.name ?? ''); setIsEditingTitle(true); }}
                title={t.browse.renameTooltip}
                style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.2rem', display: 'flex', alignItems: 'center' }}
              >
                <Edit2 size={16} />
              </button>}
            </div>
          )}

          <div className="run-meta-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
            <span>{formatDate(act.start_time, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</span>
            <span>•</span>
            <span>{formatDate(act.start_time, { hour: '2-digit', minute: '2-digit', hour12: false })} ({getTimeOfDay(act.start_time)})</span>
          </div>

          {isTreadmill && <p className="treadmill-metrics-note">{t.browse.treadmillMetricsNote}</p>}

          {!readOnly && <button
            type="button"
            onClick={() => downloadSessionCsv(act, records, fitMetadata)}
            className="export-csv-btn"
          >
            <Download size={16} aria-hidden="true" />
            {t.browse.exportCsv}
          </button>}

          {/* Dynamic Multi-Tags Row */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.65rem' }}>
            <Tag size={13} color="#94a3b8" />
            {currentTags.map(tag => (
              <span
                key={tag}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  background: 'rgba(6, 182, 212, 0.12)',
                  color: '#38bdf8',
                  border: '1px solid rgba(6, 182, 212, 0.3)',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 999,
                  fontSize: '0.72rem',
                  fontWeight: 600
                }}
              >
                {translateTag(tag, t)}
              </span>
            ))}

          </div>
        </div>

        {/* Microclimate Weather */}
        <ActivityWeatherCard
          activity={act}
          isRefreshingWeather={isRefreshingWeather}
          onRefreshWeather={onRefreshWeather}
          readOnly={readOnly}
        />
      </div>

      {/* Metric chips */}
      <div className="metric-chips-grid">
        <div className="metric-chip">
          <span className="metric-chip-label">{t.browse.distance}</span>
          <span className="metric-chip-value">
            {((officialDistanceMeters ?? act.distance_meters) / 1000).toFixed(2)}
            <span className="metric-chip-unit">km</span>
          </span>
          {officialDistanceMeters != null && (
            <span className="metric-chip-detail">
              {t.browse.raw}: {(act.distance_meters / 1000).toFixed(2)} km
            </span>
          )}
        </div>
        <div className="metric-chip">
          <span className="metric-chip-label">{t.browse.movingTime}</span>
          <span className="metric-chip-value">{formatTime(officialTimeSeconds ?? act.duration_seconds)}</span>
          {officialTimeSeconds != null && (
            <span className="metric-chip-detail">
              {t.browse.raw}: {formatTime(act.duration_seconds)}
            </span>
          )}
        </div>
        <div className="metric-chip">
          <span className="metric-chip-label">
            {t.browse.avgPace}
            {officialPaceSecKm != null
              ? <span className="metric-chip-qualifier">{t.browse.officialResultTitle}</span>
              : !!act.steady_pace_sec_km && act.steady_pace_sec_km !== act.avg_pace_sec_km && (
                <span className="metric-chip-qualifier">{t.browse.steadyPace}</span>
              )}
          </span>
          <span className="metric-chip-value" style={{ color: '#06b6d4' }}>
            {formatPace(officialPaceSecKm ?? act.steady_pace_sec_km ?? act.avg_pace_sec_km)}
            <span className="metric-chip-unit">/km</span>
          </span>
          {officialPaceSecKm != null ? (
            <span className="metric-chip-detail">
              {t.browse.raw}: {formatPace(act.steady_pace_sec_km ?? act.avg_pace_sec_km)}
            </span>
          ) : act.steady_pace_sec_km && act.steady_pace_sec_km !== act.avg_pace_sec_km && (
            <span className="metric-chip-detail">
              {t.browse.raw}: {formatPace(act.avg_pace_sec_km)}
            </span>
          )}
        </div>
        <div className="metric-chip">
          <span className="metric-chip-label">
            {act.steady_heart_rate && act.steady_heart_rate !== act.avg_heart_rate ? t.browse.steadyHr : t.browse.avgHeartRate}
          </span>
          <span className="metric-chip-value" style={{ color: '#f59e0b' }}>
            {act.steady_heart_rate || act.avg_heart_rate || '—'}
            <span className="metric-chip-unit">bpm</span>
          </span>
          {act.steady_heart_rate && act.steady_heart_rate !== act.avg_heart_rate && (
            <span className="metric-chip-detail">
              {t.browse.raw}: {act.avg_heart_rate}
            </span>
          )}
        </div>
        <div className="metric-chip">
          <span className="metric-chip-label">{t.browse.maxHeartRate}</span>
          <span className="metric-chip-value">{act.max_heart_rate ?? '—'}<span className="metric-chip-unit">bpm</span></span>
        </div>
        <div className="metric-chip">
          <span className="metric-chip-label">
            {t.browse.cadenceLabel}
            {!!act.steady_cadence && act.steady_cadence !== act.avg_cadence && (
              <span className="metric-chip-qualifier">{t.browse.steadyPace}</span>
            )}
          </span>
          <span className="metric-chip-value">
            {displayCadence ? Math.round(displayCadence) : '—'}
            <span className="metric-chip-unit">spm</span>
          </span>
          {act.steady_cadence && act.steady_cadence !== act.avg_cadence && (
            <span className="metric-chip-detail">
              {t.browse.raw}: {act.avg_cadence != null ? Math.round(act.avg_cadence) : '—'} spm
            </span>
          )}
        </div>
        <div className="metric-chip">
          <span className="metric-chip-label">{t.browse.elevationLabel}</span>
          <span className="metric-chip-value">+{act.elevation_gain_m ? Math.round(act.elevation_gain_m) : 0}<span className="metric-chip-unit">m</span></span>
        </div>
        <div className="metric-chip">
          <span className="metric-chip-label">{t.browse.caloriesLabel}</span>
          <span className="metric-chip-value">{act.calories ?? '—'}<span className="metric-chip-unit">kcal</span></span>
        </div>
        {act.training_load != null && (
          <div className="metric-chip">
            <span className="metric-chip-label">{t.browse.trainingLoad}</span>
            <span className="metric-chip-value" style={{ color: '#ec4899' }}>
              {Math.round(act.training_load)}
              <span className="metric-chip-unit">{t.browse.loadPts}</span>
            </span>
          </div>
        )}
      </div>

      {((act.pause_duration_seconds ?? 0) > 0 || (act.walk_duration_seconds ?? 0) > 0) && (
        <p className="pause-isolation-note" style={{ marginTop: '0.5rem', marginBottom: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {t.browse.excludes}{' '}
          {[
            (act.pause_duration_seconds ?? 0) > 0 ? `${formatTime(act.pause_duration_seconds!)} ${t.browse.trafficStops}` : null,
            (act.walk_duration_seconds ?? 0) > 0 ? `${formatTime(act.walk_duration_seconds!)} ${t.browse.walkBreaks} (${Math.round(act.walk_distance_meters ?? 0)} m)` : null
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      {showOfficialResult && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              {t.browse.officialResultTitle}
            </span>

            {!isEditingOfficial && hasOfficialResult && (
              <>
                <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent-amber)' }}>
                  {formatDuration(act.official_time_seconds)}
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {formatKilometres(act.official_distance_meters ?? 0)} km
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={openOfficialEditor}
                    title={t.browse.chipTimeLabel}
                    style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.15rem', display: 'flex', alignItems: 'center' }}
                  >
                    <Edit2 size={14} />
                  </button>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={clearOfficialResult}
                    style={{ background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '0.2rem 0.5rem', fontSize: '0.7rem', cursor: 'pointer' }}
                  >
                    {t.browse.officialResultClear}
                  </button>
                )}
              </>
            )}

            {!isEditingOfficial && !hasOfficialResult && (
              <>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flex: '1 1 18rem' }}>
                  {t.browse.officialResultHint}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={openOfficialEditor}
                    style={{ background: 'transparent', color: '#38bdf8', border: '1px solid rgba(6,182,212,0.35)', borderRadius: 6, padding: '0.2rem 0.55rem', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {t.browse.officialResultTitle}
                  </button>
                )}
              </>
            )}
          </div>

          {isEditingOfficial && (
            <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.6rem', marginTop: '0.5rem' }}>
              <label style={officialFieldLabelStyle}>
                {t.browse.chipTimeLabel}
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={officialHoursInput}
                    onChange={e => setOfficialHoursInput(digitsOnly(e.target.value))}
                    aria-label={`${t.browse.chipTimeLabel} h`}
                    style={{ ...officialInputStyle, width: '3rem', textAlign: 'center' }}
                  />
                  <span style={officialUnitStyle}>h</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={officialMinutesInput}
                    onChange={e => setOfficialMinutesInput(digitsOnly(e.target.value))}
                    aria-label={`${t.browse.chipTimeLabel} min`}
                    style={{ ...officialInputStyle, width: '3rem', textAlign: 'center' }}
                  />
                  <span style={officialUnitStyle}>m</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={officialSecondsInput}
                    onChange={e => setOfficialSecondsInput(digitsOnly(e.target.value))}
                    aria-label={`${t.browse.chipTimeLabel} s`}
                    style={{ ...officialInputStyle, width: '3rem', textAlign: 'center' }}
                  />
                  <span style={officialUnitStyle}>s</span>
                </span>
              </label>

              <label style={officialFieldLabelStyle}>
                {t.browse.certifiedDistanceLabel}
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={certifiedDistanceInput}
                    onChange={e => setCertifiedDistanceInput(e.target.value)}
                    placeholder="10"
                    aria-label={t.browse.certifiedDistanceLabel}
                    style={{ ...officialInputStyle, width: '5.5rem' }}
                  />
                  <span style={officialUnitStyle}>km</span>
                </span>
              </label>

              <button
                type="button"
                onClick={saveOfficialResult}
                style={{ ...officialButtonStyle, background: '#06b6d4', color: '#07090e' }}
              >
                {t.common.save}
              </button>
              <button
                type="button"
                onClick={() => { setIsEditingOfficial(false); setOfficialError(false); }}
                style={{ ...officialButtonStyle, background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.15)', fontWeight: 500 }}
              >
                {t.common.cancel}
              </button>
            </div>
          )}

          {officialError && (
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.72rem', color: '#f87171' }}>
              {t.browse.officialResultInvalid}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
