import React, { useState, useEffect } from 'react';
import { Target, Zap, Calendar, HelpCircle, X } from 'lucide-react';
import { formatPace } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { TrainingLoadCard } from './TrainingLoadCard.js';
import { BestEffortsCard } from './BestEffortsCard.js';

export const StatsView: React.FC = () => {
  const { t, format } = useTranslation();

  const formatDistanceName = (name: string) => {
    if (name === '5K') return t.stats.fiveK;
    if (name === '10K') return t.stats.tenK;
    if (name === 'Half Marathon') return t.stats.halfMarathon;
    if (name === 'Marathon') return t.stats.marathon;
    return name;
  };
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [volumePeriod, setVolumePeriod] = useState<'week' | 'month' | 'year' | 'all'>('month');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [availableMonths, setAvailableMonths] = useState<{ period: string; label: string }[]>([]);
  const [volumeData, setVolumeData] = useState<any | null>(null);
  const [loadingVolume, setLoadingVolume] = useState<boolean>(false);
  const [isMarginGuideOpen, setIsMarginGuideOpen] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/thresholds')
      .then(res => res.json())
      .then(resData => {
        setData(resData);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load stats:', err);
        setLoading(false);
      });

    fetch('/api/activities/progress-history')
      .then(res => res.json())
      .then(hist => {
        if (hist.months) {
          setAvailableMonths(hist.months);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoadingVolume(true);
    let url = `/api/activities/volume?period=${volumePeriod}`;
    if (volumePeriod === 'month' && selectedMonth !== 'all') {
      url += `&month=${selectedMonth}`;
    }
    fetch(url)
      .then(res => res.json())
      .then(vData => {
        setVolumeData(vData);
        setLoadingVolume(false);
      })
      .catch(err => {
        console.error('Failed to load volume stats:', err);
        setLoadingVolume(false);
      });
  }, [volumePeriod, selectedMonth]);

  if (loading || !data) {
    return (
      <div className="stats-grid">
        <div className="overview-card loading-skeleton" style={{ height: 400 }}></div>
      </div>
    );
  }

  const lt1 = data.latest?.lt1;
  const lt2 = data.latest?.lt2;
  const lt1Hr = data.currentThresholds?.lt1Hr ?? lt1?.lt1_hr ?? '—';
  const lt2Hr = data.currentThresholds?.lt2Hr ?? lt2?.lt2_hr ?? '—';

  const getLocalizedPeriodLabel = (label: string | undefined): string => {
    if (!label) return t.stats.volumeTitle;
    const override = t.stats.periodLabelOverrides[label];
    if (override) return override;
    if (label.includes('Season')) {
      return format(t.stats.periodLabelSeasonPattern, { year: label.replace(/\s*Season\s*/, '') });
    }
    return label;
  };

  return (
    <div className="stats-grid">
      {/* Aggregated Effort & Volume Breakdown (Weekly / Monthly / Yearly / All-Time) */}
      <section className="volume-analytics-card">
        <div className="volume-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span className="chart-title">{t.stats.volumeTitle}</span>
              <span className="profile-sync-badge">
                <Calendar size={13} /> {getLocalizedPeriodLabel(volumeData?.periodLabel)}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
              {t.stats.volumeDesc}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            {volumePeriod === 'month' && availableMonths.length > 0 && (
              <select
                className="month-picker-select"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                style={{ height: '32px', fontSize: '0.78rem', padding: '0 0.6rem', minWidth: '130px' }}
                title="Select specific month to analyze"
              >
                <option value="all">{t.stats.allRecentMonth}</option>
                {availableMonths.map(m => (
                  <option key={m.period} value={m.period}>{m.label}</option>
                ))}
              </select>
            )}

            <div className="volume-tabs">
              <button
                className={`volume-tab-btn ${volumePeriod === 'week' ? 'active' : ''}`}
                onClick={() => setVolumePeriod('week')}
              >
                {t.stats.periodWeek}
              </button>
              <button
                className={`volume-tab-btn ${volumePeriod === 'month' ? 'active' : ''}`}
                onClick={() => setVolumePeriod('month')}
              >
                {t.stats.periodMonth}
              </button>
              <button
                className={`volume-tab-btn ${volumePeriod === 'year' ? 'active' : ''}`}
                onClick={() => setVolumePeriod('year')}
              >
                {t.stats.periodYear}
              </button>
              <button
                className={`volume-tab-btn ${volumePeriod === 'all' ? 'active' : ''}`}
                onClick={() => setVolumePeriod('all')}
              >
                {t.stats.periodAll}
              </button>
            </div>
          </div>
        </div>

        {/* Volume Summary KPI Grid */}
        {loadingVolume || !volumeData ? (
          <div className="loading-skeleton" style={{ height: 160, borderRadius: 10 }}></div>
        ) : (
          <>
            <div className="volume-kpis-grid">
              <div className="volume-kpi-box">
                <span className="volume-kpi-title">{t.stats.totalDist}</span>
                <div className="volume-kpi-val" style={{ color: 'var(--accent-cyan)' }}>
                  {volumeData.totalDistanceKm} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>km</span>
                </div>
                <span className="volume-kpi-sub">{getLocalizedPeriodLabel(volumeData.periodLabel)} ({volumeData.activityCount} {t.progress.loggedActivities})</span>
              </div>

              <div className="volume-kpi-box">
                <span className="volume-kpi-title">{t.stats.totalTime}</span>
                <div className="volume-kpi-val" style={{ color: '#38bdf8' }}>
                  {volumeData.totalDurationHours} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>{t.stats.hrsTotal}</span>
                </div>
                <span className="volume-kpi-sub">{t.browse.metersPerBeat}: ~{volumeData.avgEf ?? '—'} m/beat</span>
              </div>

              <div className="volume-kpi-box highlight">
                <span className="volume-kpi-title" style={{ color: '#10b981' }}>{t.stats.zone2Mileage}</span>
                <div className="volume-kpi-val" style={{ color: '#10b981' }}>
                  {volumeData.zones?.z2?.hours || 0} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>{t.stats.hrsTotal} ({volumeData.zones?.z2?.pct || 0}%)</span>
                </div>
                <span className="volume-kpi-sub">{t.tags.easyBase} ({t.stats.zone2AerobicBase})</span>
              </div>

              <div className="volume-kpi-box">
                <span className="volume-kpi-title">{t.stats.qualityMileage}</span>
                <div className="volume-kpi-val" style={{ color: '#f59e0b' }}>
                  {((volumeData.zones?.z4?.hours || 0) + (volumeData.zones?.z5?.hours || 0)).toFixed(1)} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>{t.stats.hrsTotal} ({((volumeData.zones?.z4?.pct || 0) + (volumeData.zones?.z5?.pct || 0))}%)</span>
                </div>
                <span className="volume-kpi-sub">{t.stats.speedworkQuality}</span>
              </div>
            </div>

            {/* Proportional Zone Stack Bar */}
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {t.stats.distributionTitle}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {volumeData.totalDurationHours} {t.stats.hrsTotal}
                </span>
              </div>

              <div className="zone-visual-bar" style={{ height: 22, margin: '0.35rem 0 0.65rem 0' }}>
                <div
                  className="zone-bar-segment"
                  style={{ width: `${Math.max(volumeData.zones?.z1?.pct || 0, (volumeData.zones?.z1?.pct ? 3 : 0))}%`, background: '#64748b' }}
                  title={`${t.stats.zone1Recovery}: ${volumeData.zones?.z1?.hours}h (${volumeData.zones?.z1?.pct}%)`}
                >
                  {(volumeData.zones?.z1?.pct || 0) >= 8 ? `Z1 ${volumeData.zones.z1.pct}%` : ''}
                </div>
                <div
                  className="zone-bar-segment"
                  style={{ width: `${Math.max(volumeData.zones?.z2?.pct || 0, (volumeData.zones?.z2?.pct ? 5 : 0))}%`, background: '#10b981' }}
                  title={`${t.stats.zone2AerobicBase}: ${volumeData.zones?.z2?.hours}h (${volumeData.zones?.z2?.pct}%)`}
                >
                  {(volumeData.zones?.z2?.pct || 0) >= 8 ? `Z2 ${volumeData.zones.z2.pct}%` : ''}
                </div>
                <div
                  className="zone-bar-segment"
                  style={{ width: `${Math.max(volumeData.zones?.z3?.pct || 0, (volumeData.zones?.z3?.pct ? 3 : 0))}%`, background: '#06b6d4' }}
                  title={`${t.stats.zone3Tempo}: ${volumeData.zones?.z3?.hours}h (${volumeData.zones?.z3?.pct}%)`}
                >
                  {(volumeData.zones?.z3?.pct || 0) >= 8 ? `Z3 ${volumeData.zones.z3.pct}%` : ''}
                </div>
                <div
                  className="zone-bar-segment"
                  style={{ width: `${Math.max(volumeData.zones?.z4?.pct || 0, (volumeData.zones?.z4?.pct ? 3 : 0))}%`, background: '#f59e0b' }}
                  title={`${t.stats.zone4Threshold}: ${volumeData.zones?.z4?.hours}h (${volumeData.zones?.z4?.pct}%)`}
                >
                  {(volumeData.zones?.z4?.pct || 0) >= 8 ? `Z4 ${volumeData.zones.z4.pct}%` : ''}
                </div>
                <div
                  className="zone-bar-segment"
                  style={{ width: `${Math.max(volumeData.zones?.z5?.pct || 0, (volumeData.zones?.z5?.pct ? 3 : 0))}%`, background: '#ef4444' }}
                  title={`${t.stats.zone5Vo2Max}: ${volumeData.zones?.z5?.hours}h (${volumeData.zones?.z5?.pct}%)`}
                >
                  {(volumeData.zones?.z5?.pct || 0) >= 8 ? `Z5 ${volumeData.zones.z5.pct}%` : ''}
                </div>
              </div>

              <div className="zone-breakdown-row">
                <div className="zone-chip-stat">
                  <span className="zone-dot" style={{ background: '#64748b' }}></span>
                  <span>{t.stats.zone1Recovery}: <strong>{volumeData.zones?.z1?.hours || 0}h</strong> ({volumeData.zones?.z1?.pct || 0}%)</span>
                </div>
                <div className="zone-chip-stat">
                  <span className="zone-dot" style={{ background: '#10b981' }}></span>
                  <span>{t.stats.zone2AerobicBase}: <strong style={{ color: '#10b981' }}>{volumeData.zones?.z2?.hours || 0}h</strong> ({volumeData.zones?.z2?.pct || 0}%)</span>
                </div>
                <div className="zone-chip-stat">
                  <span className="zone-dot" style={{ background: '#06b6d4' }}></span>
                  <span>{t.stats.zone3Tempo}: <strong>{volumeData.zones?.z3?.hours || 0}h</strong> ({volumeData.zones?.z3?.pct || 0}%)</span>
                </div>
                <div className="zone-chip-stat">
                  <span className="zone-dot" style={{ background: '#f59e0b' }}></span>
                  <span>{t.stats.zone4Threshold}: <strong>{volumeData.zones?.z4?.hours || 0}h</strong> ({volumeData.zones?.z4?.pct || 0}%)</span>
                </div>
                <div className="zone-chip-stat">
                  <span className="zone-dot" style={{ background: '#ef4444' }}></span>
                  <span>{t.stats.zone5Vo2Max}: <strong>{volumeData.zones?.z5?.hours || 0}h</strong> ({volumeData.zones?.z5?.pct || 0}%)</span>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Garmin-Equivalent Acute:Chronic Training Load & Optimal Tunnel */}
      <TrainingLoadCard />

      {/* Race Predictions Table */}
      <section className="chart-card">
        <div className="chart-header">
          <div>
            <span className="chart-title">{t.stats.racePredictions}</span>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.2rem' }}>
              {t.stats.subtitle}
            </p>
          </div>
        </div>

        <div className="predictions-grid">
          {data.predictions?.map((pred: any) => (
            <div key={pred.distanceName} className="prediction-item">
              <span className="prediction-distance">{formatDistanceName(pred.distanceName)}</span>
              <div className="prediction-time">{pred.timeFormatted}</div>
              <span className="prediction-pace">{t.stats.predictedPace}: {pred.paceFormatted}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Personal Bests & Best Efforts (1K, 5K, 10K, Half Marathon, Marathon) */}
      <BestEffortsCard />

      {/* Polarized Training Distribution Guide */}
      <section className="goal-markers-grid">
        <div className="goal-card">
          <div className="goal-card-header">
            <span className="goal-card-title">{t.stats.polarizedBalanceTitle}</span>
            <Target size={18} color="#10b981" />
          </div>
          <div className="goal-stat-highlight" style={{ color: '#10b981', fontSize: '1.4rem' }}>
            {t.stats.polarizedBalanceValue}
          </div>
          <p className="goal-stat-desc">
            {t.stats.polarizedBalanceDesc}
          </p>
        </div>

        <div className="goal-card">
          <div className="goal-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span className="goal-card-title">{t.stats.turnpointMarginTitle}</span>
              <button
                type="button"
                onClick={() => setIsMarginGuideOpen(true)}
                className="guide-info-trigger-btn"
                title="Learn about Aerobic Turnpoint Margin & Target Benchmarks"
                aria-label="Aerobic Turnpoint Margin Guide"
              >
                <HelpCircle size={14} />
              </button>
            </div>
            <Zap size={18} color="#06b6d4" />
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', margin: '0.4rem 0' }}>
            <div className="goal-stat-highlight" style={{ color: '#06b6d4', fontSize: '1.4rem' }}>
              {lt1 && lt2 && lt1.lt1_pace_sec_km && lt2.lt2_pace_sec_km 
                ? format(t.stats.gapSeconds, { seconds: Math.round(lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km) })
                : (lt1?.lt1_pace_sec_km ? format(t.stats.estGapSeconds, { seconds: Math.round(lt1.lt1_pace_sec_km * 0.14) }) : '--')}
            </div>
            {lt1?.lt1_pace_sec_km && lt2?.lt2_pace_sec_km && (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '0.2rem 0.55rem',
                  borderRadius: 6,
                  color: (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km <= 50) ? '#10b981' : (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km <= 70) ? '#06b6d4' : '#f59e0b',
                  background: (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km <= 50) ? 'rgba(16, 185, 129, 0.15)' : (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km <= 70) ? 'rgba(6, 182, 212, 0.15)' : 'rgba(245, 158, 11, 0.15)'
                }}
              >
                {lt2.is_estimated
                  ? t.stats.turnpointEstimatedFromLt1
                  : (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km <= 50)
                    ? t.stats.turnpointOptimalAnchor
                    : (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km <= 70)
                      ? t.stats.turnpointWellConditioned
                      : t.stats.turnpointBaseOpportunity}
              </span>
            )}
          </div>

          <p className="goal-stat-desc">
            {lt1?.lt1_pace_sec_km && lt2?.lt2_pace_sec_km
              ? format(t.stats.paceGapCalc, {
                  easy: formatPace(lt1.lt1_pace_sec_km),
                  threshold: formatPace(lt2.lt2_pace_sec_km),
                  estimated: lt2.is_estimated ? t.stats.estimatedSuffix : ''
                })
              : lt1?.lt1_pace_sec_km
                ? format(t.stats.calibratedAt, { pace: formatPace(lt1.lt1_pace_sec_km) })
                : t.stats.notCalibrated}
          </p>
        </div>
      </section>

      {/* Aerobic Turnpoint Margin Educational Guide Modal */}
      {isMarginGuideOpen && (
        <div className="modal-overlay" onClick={() => setIsMarginGuideOpen(false)}>
          <div className="modal-content" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Zap size={20} color="#06b6d4" />
                <h2 className="modal-title" style={{ color: 'var(--text-primary)' }}>{t.stats.turnpointGuideTitle}</h2>
              </div>
              <button className="modal-close-btn" onClick={() => setIsMarginGuideOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '0.5rem 0' }}>
              <div>
                <h4 style={{ color: 'var(--text-primary)', margin: '0 0 0.4rem 0', fontSize: '0.95rem' }}>
                  {t.stats.turnpointWhatIsTitle}
                </h4>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
                  <>
                    {t.stats.whatIsP1}
                    <b>{t.stats.whatIsBoldMargin}</b>
                    {t.stats.whatIsP2}
                    <b>{t.stats.whatIsBoldLt1}</b>
                    {t.stats.whatIsP3}
                    <b>{t.stats.whatIsBoldLt2}</b>
                    {t.stats.whatIsP4}
                  </>
                </p>
              </div>

              {/* Target Benchmark Tiers */}
              <div>
                <h4 style={{ color: 'var(--text-primary)', margin: '0 0 0.6rem 0', fontSize: '0.88rem' }}>
                  {t.stats.turnpointStandardsTitle}
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <div style={{ padding: '0.75rem', borderRadius: 8, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#10b981' }}>{t.stats.turnpointTierEliteTitle}</span>
                      <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>{t.stats.turnpointTierEliteBadge}</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
                      {t.stats.turnpointTierEliteDesc}
                    </p>
                  </div>

                  <div style={{ padding: '0.75rem', borderRadius: 8, background: 'rgba(6, 182, 212, 0.08)', border: '1px solid rgba(6, 182, 212, 0.25)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#06b6d4' }}>{t.stats.turnpointTierWellTitle}</span>
                      <span style={{ fontSize: '0.72rem', color: '#06b6d4', fontWeight: 600 }}>{t.stats.turnpointTierWellBadge}</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
                      {t.stats.turnpointTierWellDesc}
                    </p>
                  </div>

                  <div style={{ padding: '0.75rem', borderRadius: 8, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#f59e0b' }}>{t.stats.turnpointTierDevTitle}</span>
                      <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600 }}>{t.stats.turnpointTierDevBadge}</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
                      {t.stats.turnpointTierDevDesc}
                    </p>
                  </div>
                </div>
              </div>

              {/* Your Current Status & Training Direction */}
              <div style={{ padding: '0.85rem', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                <h4 style={{ color: 'var(--text-primary)', margin: '0 0 0.4rem 0', fontSize: '0.85rem' }}>
                  {t.stats.turnpointOptimizeTitle}
                </h4>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  <li>
                    <b>{t.stats.optimizeGapWideBold}</b>
                    {format(t.stats.optimizeGapWideBody, { hr: lt1Hr ?? '' })}
                  </li>
                  <li>
                    <b>{t.stats.optimizeGapNarrowBold}</b>
                    {t.stats.optimizeGapNarrowBody}
                  </li>
                </ul>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className="save-profile-btn"
                  style={{ width: 'auto', padding: '0.45rem 1.25rem', fontSize: '0.82rem' }}
                  onClick={() => setIsMarginGuideOpen(false)}
                >
                  {t.stats.turnpointGotIt || 'Got It'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

