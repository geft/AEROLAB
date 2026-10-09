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
  const { formatDate, language } = useTranslation();
  const displayCadence = act.steady_cadence || act.avg_cadence;
  const isTreadmill = act.is_treadmill || isTreadmillFitMetadata(fitMetadata);

  const currentTags = getActivityTags(act);

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
          <span className="metric-chip-value">{(act.distance_meters / 1000).toFixed(2)}<span className="metric-chip-unit">km</span></span>
        </div>
        <div className="metric-chip">
          <span className="metric-chip-label">{t.browse.movingTime}</span>
          <span className="metric-chip-value">{formatTime(act.duration_seconds)}</span>
        </div>
        <div className="metric-chip">
          <span className="metric-chip-label">
            {t.browse.avgPace}
            {!!act.steady_pace_sec_km && act.steady_pace_sec_km !== act.avg_pace_sec_km && (
              <span className="metric-chip-qualifier">{t.browse.steadyPace}</span>
            )}
          </span>
          <span className="metric-chip-value" style={{ color: '#06b6d4' }}>
            {formatPace(act.steady_pace_sec_km || act.avg_pace_sec_km)}
            <span className="metric-chip-unit">/km</span>
          </span>
          {act.steady_pace_sec_km && act.steady_pace_sec_km !== act.avg_pace_sec_km && (
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
    </section>
  );
};
