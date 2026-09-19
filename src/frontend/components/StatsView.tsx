import React, { useState, useEffect } from 'react';
import { Target, Trophy, Flame, Activity, ShieldCheck, Zap, Calendar, TrendingUp, Clock, Mountain, HelpCircle, X, CheckCircle } from 'lucide-react';
import { formatPace } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { TrainingLoadCard } from './TrainingLoadCard.js';
import { BestEffortsCard } from './BestEffortsCard.js';

export const StatsView: React.FC = () => {
  const { t, language } = useTranslation();

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
  const vo2Max = data.latest?.vo2Max ?? null;
  const lt1Hr = data.currentThresholds?.lt1Hr ?? lt1?.lt1_hr ?? 145;
  const lt2Hr = data.currentThresholds?.lt2Hr ?? lt2?.lt2_hr ?? 165;
  const zones = data.zones || {
    z1: [0, lt1Hr - 14],
    z2: [lt1Hr - 13, lt1Hr],
    z3: [lt1Hr + 1, lt2Hr - 1],
    z4: [lt2Hr, lt2Hr + 15],
    z5: [lt2Hr + 16, 220]
  };
  const lt1RangeStr = `${lt1Hr}`;

  return (
    <div className="stats-grid">
      {/* Aggregated Effort & Volume Breakdown (Weekly / Monthly / Yearly / All-Time) */}
      <section className="volume-analytics-card">
        <div className="volume-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span className="chart-title">{t.stats.volumeTitle}</span>
              <span className="profile-sync-badge">
                <Calendar size={13} /> {volumeData?.periodLabel || t.stats.volumeTitle}
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

        {loadingVolume || !volumeData ? (
          <div className="loading-skeleton" style={{ height: 160, borderRadius: 10 }}></div>
        ) : (
          <>
            <div className="volume-kpis-grid">
              <div className="volume-kpi-box">
                <span className="volume-kpi-title">{t.stats.totalDist}</span>
                <div className="volume-kpi-val" style={{ color: '#06b6d4' }}>
                  {volumeData.totalDistanceKm} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>km</span>
                </div>
                <span className="volume-kpi-sub">{volumeData.activityCount} {t.browse.totalRuns}</span>
              </div>

              <div className="volume-kpi-box">
                <span className="volume-kpi-title">{t.stats.totalTime}</span>
                <div className="volume-kpi-val">
                  {volumeData.totalDurationHours} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>hrs</span>
                </div>
                <span className="volume-kpi-sub">{t.stats.totalTime}</span>
              </div>

              <div className="volume-kpi-box highlight">
                <span className="volume-kpi-title" style={{ color: '#10b981' }}>{t.stats.zone2Mileage}</span>
                <div className="volume-kpi-val" style={{ color: '#10b981' }}>
                  {volumeData.zones?.z2?.hours || 0} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>hrs</span>
                </div>
                <span className="volume-kpi-sub">
                  <strong style={{ color: '#10b981' }}>{volumeData.zones?.z2?.pct || 0}%</strong>
                </span>
              </div>

              <div className="volume-kpi-box">
                <span className="volume-kpi-title">{t.stats.qualityMileage}</span>
                <div className="volume-kpi-val" style={{ color: '#f59e0b' }}>
                  {((volumeData.zones?.z4?.hours || 0) + (volumeData.zones?.z5?.hours || 0)).toFixed(1)} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>hrs</span>
                </div>
                <span className="volume-kpi-sub">
                  {(((volumeData.zones?.z4?.pct || 0) + (volumeData.zones?.z5?.pct || 0))).toFixed(1)}%
                </span>
              </div>

              <div className="volume-kpi-box">
                <span className="volume-kpi-title">{t.stats.totalElev}</span>
                <div className="volume-kpi-val">
                  {volumeData.totalElevationGainM} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>m</span>
                </div>
                <span className="volume-kpi-sub">{t.stats.totalElev}</span>
              </div>
            </div>

            {/* Visual Zone Distribution Bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {t.stats.distributionTitle}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {volumeData.totalDurationHours} hrs total
                </span>
              </div>

              <div className="zone-visual-bar" style={{ height: 22, margin: '0.35rem 0' }}>
                <div
                  className="zone-bar-segment"
                  style={{ width: `${Math.max(volumeData.zones?.z1?.pct || 0, (volumeData.zones?.z1?.pct ? 3 : 0))}%`, background: '#64748b' }}
                  title={`Zone 1: ${volumeData.zones?.z1?.hours}h (${volumeData.zones?.z1?.pct}%)`}
                >
                  {(volumeData.zones?.z1?.pct || 0) >= 8 ? `Z1 ${volumeData.zones.z1.pct}%` : ''}
                </div>
                <div
                  className="zone-bar-segment"
                  style={{ width: `${Math.max(volumeData.zones?.z2?.pct || 0, (volumeData.zones?.z2?.pct ? 5 : 0))}%`, background: '#10b981' }}
                  title={`Zone 2: ${volumeData.zones?.z2?.hours}h (${volumeData.zones?.z2?.pct}%)`}
                >
                  {(volumeData.zones?.z2?.pct || 0) >= 8 ? `Z2 ${volumeData.zones.z2.pct}%` : ''}
                </div>
                <div
                  className="zone-bar-segment"
                  style={{ width: `${Math.max(volumeData.zones?.z3?.pct || 0, (volumeData.zones?.z3?.pct ? 3 : 0))}%`, background: '#06b6d4' }}
                  title={`Zone 3: ${volumeData.zones?.z3?.hours}h (${volumeData.zones?.z3?.pct}%)`}
                >
                  {(volumeData.zones?.z3?.pct || 0) >= 8 ? `Z3 ${volumeData.zones.z3.pct}%` : ''}
                </div>
                <div
                  className="zone-bar-segment"
                  style={{ width: `${Math.max(volumeData.zones?.z4?.pct || 0, (volumeData.zones?.z4?.pct ? 3 : 0))}%`, background: '#f59e0b' }}
                  title={`Zone 4: ${volumeData.zones?.z4?.hours}h (${volumeData.zones?.z4?.pct}%)`}
                >
                  {(volumeData.zones?.z4?.pct || 0) >= 8 ? `Z4 ${volumeData.zones.z4.pct}%` : ''}
                </div>
                <div
                  className="zone-bar-segment"
                  style={{ width: `${Math.max(volumeData.zones?.z5?.pct || 0, (volumeData.zones?.z5?.pct ? 3 : 0))}%`, background: '#ef4444' }}
                  title={`Zone 5: ${volumeData.zones?.z5?.hours}h (${volumeData.zones?.z5?.pct}%)`}
                >
                  {(volumeData.zones?.z5?.pct || 0) >= 8 ? `Z5 ${volumeData.zones.z5.pct}%` : ''}
                </div>
              </div>

              <div className="zone-breakdown-row">
                <div className="zone-chip-stat">
                  <span className="zone-dot" style={{ background: '#64748b' }}></span>
                  <span>Z1 Recovery: <strong>{volumeData.zones?.z1?.hours || 0}h</strong> ({volumeData.zones?.z1?.pct || 0}%)</span>
                </div>
                <div className="zone-chip-stat">
                  <span className="zone-dot" style={{ background: '#10b981' }}></span>
                  <span>Z2 Aerobic Base: <strong style={{ color: '#10b981' }}>{volumeData.zones?.z2?.hours || 0}h</strong> ({volumeData.zones?.z2?.pct || 0}%)</span>
                </div>
                <div className="zone-chip-stat">
                  <span className="zone-dot" style={{ background: '#06b6d4' }}></span>
                  <span>Z3 Tempo: <strong>{volumeData.zones?.z3?.hours || 0}h</strong> ({volumeData.zones?.z3?.pct || 0}%)</span>
                </div>
                <div className="zone-chip-stat">
                  <span className="zone-dot" style={{ background: '#f59e0b' }}></span>
                  <span>Z4 Threshold: <strong>{volumeData.zones?.z4?.hours || 0}h</strong> ({volumeData.zones?.z4?.pct || 0}%)</span>
                </div>
                <div className="zone-chip-stat">
                  <span className="zone-dot" style={{ background: '#ef4444' }}></span>
                  <span>Z5 VO2 Max: <strong>{volumeData.zones?.z5?.hours || 0}h</strong> ({volumeData.zones?.z5?.pct || 0}%)</span>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Garmin-Equivalent Acute:Chronic Training Load & Optimal Tunnel */}
      <TrainingLoadCard />

      {/* Current Physiological Benchmarks */}
      <section className="benchmarks-grid">
        <div className="benchmark-card">
          <span className="benchmark-label">{t.stats.aerobicTurnpoint}</span>
          <div className="benchmark-value" style={{ color: '#10b981' }}>
            {lt1?.lt1_pace_sec_km ? formatPace(lt1.lt1_pace_sec_km) : '5:10/km (Est.)'}
          </div>
          <span className="benchmark-sub">
            {t.progress.zone2Ceiling}: {lt1RangeStr} bpm
          </span>
          <div className="threshold-marker-badge">
            <ShieldCheck size={12} /> {t.stats.aerobicTurnpoint}: {lt1RangeStr} bpm
          </div>
        </div>

        <div className="benchmark-card">
          <span className="benchmark-label">{t.stats.anaerobicThreshold}</span>
          <div className="benchmark-value" style={{ color: '#f59e0b' }}>
            {lt2?.lt2_pace_sec_km ? `${formatPace(lt2.lt2_pace_sec_km)}${lt2.is_estimated ? ' (Est.)' : ''}` : '--'}
          </div>
          <span className="benchmark-sub">
            {t.stats.anaerobicThreshold}: ~{lt2Hr} bpm
          </span>
          <div className="threshold-marker-badge amber">
            <Zap size={12} /> {t.stats.anaerobicThreshold}: {lt2Hr} bpm
          </div>
        </div>

        <div className="benchmark-card">
          <span className="benchmark-label">{t.progress.vdotTrend}</span>
          <div className="benchmark-value" style={{ color: '#8b5cf6' }}>
            {vo2Max} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>ml/kg/min</span>
          </div>
          <span className="benchmark-sub">{t.stats.predictedPace}</span>
        </div>

        <div className="benchmark-card">
          <span className="benchmark-label">{t.browse.efficiencyFactor}</span>
          <div className="benchmark-value" style={{ color: '#06b6d4' }}>
            {lt1?.baseline_economy_ef ?? '1.14'}
          </div>
          <span className="benchmark-sub">{t.browse.metersPerBeat}</span>
        </div>
      </section>

      {/* Dynamic Calibrated Heart Rate Zones */}
      <section className="chart-card zones-section">
        <div className="chart-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span className="chart-title">{t.stats.zonesTitle}</span>
              <span className="profile-sync-badge">
                <Activity size={13} /> {t.stats.continuousAutoCalibration}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
              {t.stats.subtitle}
            </p>
          </div>
        </div>

        {/* Proportional Zone Bar */}
        <div className="zone-visual-bar">
          <div className="zone-bar-segment" style={{ width: '20%', background: '#64748b' }}>
            Z1 (&lt;{zones.z2[0]})
          </div>
          <div className="zone-bar-segment" style={{ width: '25%', background: '#10b981' }}>
            Z2 ({zones.z2[0]}–{zones.z2[1]})
          </div>
          <div className="zone-bar-segment" style={{ width: '22%', background: '#06b6d4' }}>
            Z3 ({zones.z3[0]}–{zones.z3[1]})
          </div>
          <div className="zone-bar-segment" style={{ width: '20%', background: '#f59e0b' }}>
            Z4 ({zones.z4[0]}–{zones.z4[1]})
          </div>
          <div className="zone-bar-segment" style={{ width: '13%', background: '#ef4444' }}>
            Z5 ({zones.z5[0]}+)
          </div>
        </div>

        {/* 5 Zone Cards Grid */}
        <div className="zones-grid">
          {/* Zone 1 */}
          <div className="zone-card">
            <div className="zone-card-header">
              <span className="zone-tag" style={{ background: 'rgba(100, 116, 139, 0.2)', color: '#94a3b8' }}>Zone 1</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>&lt; 60% HRR</span>
            </div>
            <div className="zone-range" style={{ color: '#94a3b8' }}>&lt; {zones.z2[0]} <span style={{ fontSize: '0.85rem' }}>bpm</span></div>
            <span className="zone-name">Z1</span>
            <p className="zone-desc">
              {t.stats.zoneDesc.z1}
            </p>
          </div>

          {/* Zone 2 */}
          <div className="zone-card zone-highlight">
            <div className="zone-card-header">
              <span className="zone-tag" style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#10b981' }}>Zone 2</span>
              <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>{t.tags.easyBase}</span>
            </div>
            <div className="zone-range" style={{ color: '#10b981' }}>{zones.z2[0]} – {zones.z2[1]} <span style={{ fontSize: '0.85rem' }}>bpm</span></div>
            <span className="zone-name">Z2</span>
            <p className="zone-desc">
              {t.stats.zoneDesc.z2}
            </p>
          </div>

          {/* Zone 3 */}
          <div className="zone-card">
            <div className="zone-card-header">
              <span className="zone-tag" style={{ background: 'rgba(6, 182, 212, 0.2)', color: '#06b6d4' }}>Zone 3</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>70–80% HRR</span>
            </div>
            <div className="zone-range" style={{ color: '#06b6d4' }}>{zones.z3[0]} – {zones.z3[1]} <span style={{ fontSize: '0.85rem' }}>bpm</span></div>
            <span className="zone-name">Z3</span>
            <p className="zone-desc">
              {t.stats.zoneDesc.z3}
            </p>
          </div>

          {/* Zone 4 */}
          <div className="zone-card">
            <div className="zone-card-header">
              <span className="zone-tag" style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>Zone 4</span>
              <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600 }}>{t.tags.threshold}</span>
            </div>
            <div className="zone-range" style={{ color: '#f59e0b' }}>{zones.z4[0]} – {zones.z4[1]} <span style={{ fontSize: '0.85rem' }}>bpm</span></div>
            <span className="zone-name">Z4</span>
            <p className="zone-desc">
              {t.stats.zoneDesc.z4}
            </p>
          </div>

          {/* Zone 5 */}
          <div className="zone-card">
            <div className="zone-card-header">
              <span className="zone-tag" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}>Zone 5</span>
              <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>&gt; 90% HRR</span>
            </div>
            <div className="zone-range" style={{ color: '#ef4444' }}>{zones.z5[0]}+ <span style={{ fontSize: '0.85rem' }}>bpm</span></div>
            <span className="zone-name">Z5</span>
            <p className="zone-desc">
              {t.stats.zoneDesc.z5}
            </p>
          </div>
        </div>
      </section>

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

      {/* Personal Bests & Best Efforts (1K, 1 Mile, 5K, 10K, Half Marathon) */}
      <BestEffortsCard />

      {/* Polarized Training Distribution Guide */}
      <section className="goal-markers-grid">
        <div className="goal-card">
          <div className="goal-card-header">
            <span className="goal-card-title">{t.stats.polarizedBalanceTitle}</span>
            <Target size={18} color="#10b981" />
          </div>
          <div className="goal-stat-highlight" style={{ color: '#10b981', fontSize: '1.4rem' }}>
            {language === 'zh' ? '82% 低强度 / 18% 高强度' : '82% Low / 18% High'}
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
                ? (language === 'zh' ? `差距 ${Math.round(lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km)} 秒` : `${Math.round(lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km)}s gap`)
                : (lt1?.lt1_pace_sec_km ? (language === 'zh' ? `预估差距 ${Math.round(lt1.lt1_pace_sec_km * 0.14)} 秒` : `${Math.round(lt1.lt1_pace_sec_km * 0.14)}s est. gap`) : '--')}
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
              ? (language === 'zh'
                  ? `轻松跑 (${formatPace(lt1.lt1_pace_sec_km)}) 与乳酸阈值跑 (${formatPace(lt2.lt2_pace_sec_km)}${lt2.is_estimated ? ' 预估' : ''}) 之间的配速差距。随着有氧能力的提高，这一差距将逐渐收窄。`
                  : `Pace gap between Easy (${formatPace(lt1.lt1_pace_sec_km)}) and Threshold (${formatPace(lt2.lt2_pace_sec_km)}${lt2.is_estimated ? ' Est.' : ''}). Narrows as aerobic fitness improves.`)
              : lt1?.lt1_pace_sec_km
                ? (language === 'zh'
                    ? `轻松跑基础配速已校准为 ${formatPace(lt1.lt1_pace_sec_km)}。进行一次乳酸阈值训练以校准精准的LT2边际。`
                    : `Easy base pace calibrated at ${formatPace(lt1.lt1_pace_sec_km)}. Run a threshold workout to calibrate precise LT2 margin.`)
                : (language === 'zh'
                    ? '进行稳定的有氧基础跑和阈值训练，以校准您的转折点边际。'
                    : 'Run steady aerobic base and threshold workouts to calibrate your turnpoint margin.')}
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
                  {language === 'zh' ? (
                    <><b>有氧转折点边际</b>是指您的<b>基础有氧配速 (LT1)</b> 与<b>乳酸阈值配速 (LT2)</b> 之间的配速差距。在耐力生理学（如 Stephen Seiler、Olbrecht、Maffetone）中，它衡量了相对于您极限1小时持续速度而言，脂肪氧化和线粒体毛细血管基础的发展程度。</>
                  ) : (
                    <>The <b>Aerobic Turnpoint Margin</b> is the pace spread between your <b>Aerobic Base (LT1)</b> and your <b>Lactate Threshold (LT2)</b>. In endurance physiology (e.g. Stephen Seiler, Olbrecht, Maffetone), it measures how well-developed your lipid oxidation and mitochondrial capillary foundation are relative to your maximum 1-hour sustained velocity.</>
                  )}
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
                    {language === 'zh' ? (
                      <><b>若差距 &gt; 70秒</b>：严格在LT1以下（&lt; {lt1Hr} bpm）增加每周里程。避免将轻松跑跑得过快；真正的2区跑量可触发线粒体生物合成，在不提升心率的情况下拉升LT1配速。</>
                    ) : (
                      <><b>If your gap is &gt; 70s</b>: Increase weekly mileage strictly below LT1 (&lt; {lt1Hr} bpm). Avoid the temptation to run easy days too fast; true Zone 2 miles trigger mitochondrial biogenesis that pulls LT1 pace faster without raising heart rate.</>
                    )}
                  </li>
                  <li>
                    {language === 'zh' ? (
                      <><b>若差距 &lt; 45秒</b>：您的有氧基础已非常发达！若想跑得更快，请引入优质的LT2阈值间歇（如4区内的3x15分钟），以进一步提升无氧天花板。</>
                    ) : (
                      <><b>If your gap is &lt; 45s</b>: Your aerobic base is well-developed! To run faster, introduce quality LT2 threshold intervals (e.g. 3x15min in Zone 4) to lift your anaerobic ceiling higher.</>
                    )}
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

