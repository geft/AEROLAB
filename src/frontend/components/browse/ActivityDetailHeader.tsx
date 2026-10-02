import React, { useState, useEffect } from 'react';
import type { Activity, ActivityRecord, ActivityUpdate } from '../../types/api.js';

import type { DisplayTitleFn } from '../BrowseView.js';
import type { Translations } from '../../i18n/types.js';
import { Edit2, Tag, Plus, X, Check, ShieldCheck, Download } from 'lucide-react';
import { ActivityWeatherCard } from './ActivityWeatherCard';
import { translateTag } from '../../i18n/tagTranslator';
import { translateActivityName } from '../../i18n/coachTranslator.js';
import { useTranslation } from '../../i18n/LanguageContext';
import { patchActivity } from '../../api/client.js';
import { downloadSessionCsv } from '../../utils/sessionCsv.js';

const COMMON_TAG_PRESETS = [
  'Easy Base', 'Long Run', 'Recovery', 'Threshold', 'VO2 Max',
  'Tempo', 'Marathon Pace', 'Strides', 'Race'
];

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
  showTagMenu: boolean;
  setShowTagMenu: React.Dispatch<React.SetStateAction<boolean>>;
  tagMenuRef: React.RefObject<HTMLDivElement | null>;
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
  showTagMenu,
  setShowTagMenu,
  tagMenuRef,
  t,
  readOnly = false
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [customTitle, setCustomTitle] = useState<string>('');
  const { formatDate, language } = useTranslation();

  // Parse current tags safely
  let currentTags: string[] = [];
  try {
    currentTags = act.tags ? JSON.parse(act.tags) : [];
  } catch {
    currentTags = [];
  }

  // Dismiss edit mode if activity ID changes
  useEffect(() => {
    setIsEditingTitle(false);
  }, [act.id]);

  const handleUpdateTags = async (tags: string[]) => {
    try {
      await patchActivity(act.id, { tags });
      onActivityUpdated?.({ id: act.id, tags: JSON.stringify(tags) });
    } catch (err) {
      console.error('Failed to update tags:', err);
    }
  };

  const handleAddTag = (tagToAdd: string) => {
    const trimmed = tagToAdd.trim();
    if (!trimmed || currentTags.includes(trimmed)) return;
    if (!COMMON_TAG_PRESETS.includes(trimmed)) return;
    const updated = [...currentTags, trimmed];
    handleUpdateTags(updated);
    setShowTagMenu(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const updated = currentTags.filter(t => t !== tagToRemove);
    handleUpdateTags(updated);
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
                placeholder="e.g. Standard Chartered Marathon"
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
                Save
              </button>
              {!readOnly && <button
                onClick={() => setIsEditingTitle(false)}
                style={{ background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '0.4rem 0.75rem', cursor: 'pointer' }}
              >
                Cancel
              </button>}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
              <h1 style={{ margin: 0 }}>{translateActivityName(getDisplayTitle(act, t), language)}</h1>
              {!readOnly && <button
                onClick={() => { setCustomTitle(act.name ?? ''); setIsEditingTitle(true); }}
                title="Rename activity or name special race"
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

          <button
            type="button"
            onClick={() => downloadSessionCsv(act, records, fitMetadata)}
            className="filter-pill-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.65rem' }}
          >
            <Download size={14} />
            {t.browse.exportCsv}
          </button>

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
                {!readOnly && <X
                  size={11}
                  style={{ cursor: 'pointer', opacity: 0.7 }}
                  onClick={() => handleRemoveTag(tag)}
                />}
              </span>
            ))}

            {!readOnly && <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowTagMenu(!showTagMenu)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px dashed rgba(255, 255, 255, 0.2)',
                  color: '#94a3b8',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 999,
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.2rem'
                }}
              >
                <Plus size={12} />
                <span>Tag</span>
              </button>

              {showTagMenu && (
                <div
                  ref={tagMenuRef}
                  style={{
                    position: 'absolute',
                    top: '120%',
                    left: 0,
                    zIndex: 30,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    padding: '0.6rem',
                    boxShadow: 'var(--card-shadow)',
                    width: '210px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.3rem', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>{t.browse.existingTags}</span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{currentTags.length} {t.browse.activeCount}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '230px', overflowY: 'auto' }}>
                    {COMMON_TAG_PRESETS.map(preset => {
                      const isApplied = currentTags.includes(preset);
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            if (isApplied) {
                              handleRemoveTag(preset);
                            } else {
                              handleAddTag(preset);
                            }
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.35rem 0.55rem',
                            borderRadius: 6,
                            fontSize: '0.74rem',
                            fontWeight: isApplied ? 600 : 400,
                            background: isApplied ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                            color: isApplied ? '#38bdf8' : 'var(--text-secondary)',
                            border: isApplied ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span>{translateTag(preset, t)}</span>
                          {isApplied ? <Check size={13} color="#38bdf8" /> : <Plus size={12} color="var(--text-muted)" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>}
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
            {t.browse.avgPace} {act.steady_pace_sec_km && act.steady_pace_sec_km !== act.avg_pace_sec_km ? `(${t.browse.steadyPace})` : ''}
          </span>
          <span className="metric-chip-value" style={{ color: '#06b6d4' }}>
            {formatPace(act.steady_pace_sec_km || act.avg_pace_sec_km)}
            <span className="metric-chip-unit">/km</span>
          </span>
          {act.steady_pace_sec_km && act.steady_pace_sec_km !== act.avg_pace_sec_km && (
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
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
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
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
            {t.browse.cadenceLabel} {act.steady_cadence && act.steady_cadence !== act.avg_cadence ? `(${t.browse.steadyPace})` : ''}
          </span>
          <span className="metric-chip-value">
            {act.steady_cadence || act.avg_cadence || '—'}
            <span className="metric-chip-unit">spm</span>
          </span>
          {act.steady_cadence && act.steady_cadence !== act.avg_cadence && (
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {t.browse.raw}: {act.avg_cadence} spm
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

      {/* Steady State & Pause/Walk Isolation Banner */}
      {((act.pause_duration_seconds ?? 0) > 0 || (act.walk_duration_seconds ?? 0) > 0) && (
        <div
          className="pause-isolation-banner"
          style={{
            marginTop: '1rem',
            padding: '0.75rem 1rem',
            background: 'rgba(6, 182, 212, 0.08)',
            border: '1px solid rgba(6, 182, 212, 0.22)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <ShieldCheck size={16} color="#06b6d4" />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 500 }}>
              <strong style={{ color: '#06b6d4' }}>{t.browse.steadyIsolated}:</strong>{' '}
              {act.steady_pace_sec_km ? `${formatPace(act.steady_pace_sec_km)}/km ${t.common.pace}` : ''}
              {act.steady_cadence ? ` • ${act.steady_cadence} spm ${t.common.cadence}` : ''}
              {act.steady_heart_rate ? ` • ${act.steady_heart_rate} bpm ${t.common.heartRate}` : ''}
              {act.steady_stance_time ? ` • ${Math.round(act.steady_stance_time)} ms ${t.browse.groundContactTime}` : ''}
            </span>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {t.browse.excludes} {act.pause_duration_seconds ? `${formatTime(act.pause_duration_seconds)} ${t.browse.trafficStops}` : ''}
            {act.pause_duration_seconds && act.walk_duration_seconds ? ' & ' : ''}
            {act.walk_duration_seconds ? `${formatTime(act.walk_duration_seconds)} ${t.browse.walkBreaks} (${Math.round(act.walk_distance_meters || 0)}m)` : ''}
          </div>
        </div>
      )}
    </section>
  );
};
