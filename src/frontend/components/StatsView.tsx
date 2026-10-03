import React, { useState, useEffect } from 'react';
import type { ThresholdsResponse, VolumeData } from '../types/api.js';
import { Target, Zap, Calendar, HelpCircle, X, RefreshCw } from 'lucide-react';
import { formatDuration, formatPace } from '../utils/formatters.js';
import { raceBenchmarkFor, RACE_BENCHMARK_LEVELS } from '../utils/raceBenchmarks.js';
import { classifyTurnpointMargin, estimateTurnpointGapSeconds } from '../utils/turnpointMargin.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { TrainingLoadCard } from './TrainingLoadCard.js';
import { BestEffortsCard } from './BestEffortsCard.js';
import { getProfile, getProgressHistory, getThresholds, getVolume } from '../api/client.js';

export const StatsView: React.FC = () => {
  const { t, format, formatDate } = useTranslation();

  const formatDistanceName = (name: string) => {
    if (name === '5K') return t.stats.fiveK;
    if (name === '10K') return t.stats.tenK;
    if (name === 'Half Marathon') return t.stats.halfMarathon;
    if (name === 'Marathon') return t.stats.marathon;
    return name;
  };
  const [data, setData] = useState<ThresholdsResponse | null>(null);
  const [completedRequest, setCompletedRequest] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const loading = completedRequest !== retryCount;
  const [volumePeriod, setVolumePeriod] = useState<'week' | 'month' | 'year' | 'all'>('month');
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [availableMonths, setAvailableMonths] = useState<{ period: string; label: string }[]>([]);
  const [volumeData, setVolumeData] = useState<VolumeData | null>(null);
  const [completedVolumeRequest, setCompletedVolumeRequest] = useState<string | null>(null);
  const [volumeLoadError, setVolumeLoadError] = useState(false);
  const [volumeRetryCount, setVolumeRetryCount] = useState(0);
  const volumeRequest = [volumePeriod, selectedMonth, volumeRetryCount].join(':');
  const loadingVolume = completedVolumeRequest !== volumeRequest;
  const [isMarginGuideOpen, setIsMarginGuideOpen] = useState<boolean>(false);
  const [demographics, setDemographics] = useState<{ age: number | null; gender: string | null } | null>(null);
  const [openPredictionInfo, setOpenPredictionInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!isMonthPickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMonthPickerOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isMonthPickerOpen]);

  const benchmarkLabels = [
    t.stats.benchmarkBeginner,
    t.stats.benchmarkNovice,
    t.stats.benchmarkIntermediate,
    t.stats.benchmarkAdvanced,
    t.stats.benchmarkElite
  ];

  useEffect(() => {
    let cancelled = false;
    getThresholds()
      .then(resData => {
        if (cancelled) return;
        setLoadError(false);
        setData(resData);
        setCompletedRequest(retryCount);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load stats:', err);
        setLoadError(true);
        setCompletedRequest(retryCount);
      });

    getProgressHistory()
      .then(hist => {
        if (!cancelled && hist.months) {
          setAvailableMonths(hist.months);
        }
      })
      .catch(() => {});

    getProfile()
      .then(response => { if (!cancelled) setDemographics({ age: response.profile?.age ?? null, gender: response.profile?.gender ?? null }); })
      .catch(() => { if (!cancelled) setDemographics(null); });
    return () => { cancelled = true; };
  }, [retryCount]);

  useEffect(() => {
    let cancelled = false;
    getVolume({
      period: volumePeriod,
      ...(volumePeriod === 'month' && selectedMonth !== 'all' ? { month: selectedMonth } : {})
    })
      .then(vData => {
        if (cancelled) return;
        setVolumeLoadError(false);
        setVolumeData(vData);
        setCompletedVolumeRequest(volumeRequest);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load volume stats:', err);
        setVolumeLoadError(true);
        setCompletedVolumeRequest(volumeRequest);
      });
    return () => { cancelled = true; };
  }, [volumePeriod, selectedMonth, volumeRequest]);

  if (loading) {
    return (
      <div className="stats-grid">
        <div className="overview-card loading-skeleton" style={{ height: 400 }}></div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="load-error-state" role="alert">
        <p>{t.stats.loadFailed}</p>
        <button type="button" className="outline-btn" onClick={() => setRetryCount(count => count + 1)}>
          <RefreshCw size={14} /> {t.common.retry}
        </button>
      </div>
    );
  }

  const lt1 = data.latest?.lt1;
  const lt2 = data.latest?.lt2;
  const lt1PaceSecKm = lt1?.lt1_pace_sec_km;
  const lt2PaceSecKm = lt2?.lt2_pace_sec_km;
  const lt1Hr = data.currentThresholds?.lt1Hr ?? lt1?.lt1_hr ?? '—';
  const estimatedGapSeconds = estimateTurnpointGapSeconds(lt1PaceSecKm);
  const turnpointGapSeconds = lt1PaceSecKm != null && lt2PaceSecKm != null
    ? Math.round(lt1PaceSecKm - lt2PaceSecKm)
    : estimatedGapSeconds;
  const turnpointIsMeasured = lt1PaceSecKm != null && lt2PaceSecKm != null && !lt2?.is_estimated;
  const turnpointCategory = turnpointGapSeconds !== null ? classifyTurnpointMargin(turnpointGapSeconds) : null;
  const turnpointTier = turnpointIsMeasured ? turnpointCategory : null;

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
              <button
                type="button"
                className="month-picker-trigger"
                onClick={() => setIsMonthPickerOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={isMonthPickerOpen}
              >
                <Calendar size={16} aria-hidden="true" />
                <span>{selectedMonth === 'all'
                  ? t.stats.allRecentMonth
                  : formatDate(`${selectedMonth}-01`, { month: 'long', year: 'numeric' })}</span>
              </button>
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
        {loadingVolume || (!volumeData && !volumeLoadError) ? (
          <div className="loading-skeleton" style={{ height: 160, borderRadius: 10 }}></div>
        ) : volumeLoadError ? (
          <div className="load-error-state compact" role="alert">
            <p>{t.stats.volumeLoadFailed}</p>
            <button type="button" className="outline-btn" onClick={() => setVolumeRetryCount(count => count + 1)}>
              <RefreshCw size={14} /> {t.common.retry}
            </button>
          </div>
        ) : !volumeData ? (
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
                <span className="volume-kpi-sub">{t.browse.efficiencyFactor}: {volumeData.avgEf ?? '—'} EF</span>
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
          {data.predictions?.map((pred: ThresholdsResponse['predictions'][number]) => {
            const benchmark = raceBenchmarkFor(pred.distanceName, pred.timeSeconds, demographics?.age, demographics?.gender);
            const infoOpen = openPredictionInfo === pred.distanceName;
            const levelIndex = RACE_BENCHMARK_LEVELS.indexOf(benchmark?.achievedLevel ?? 'beginner');
            return (
              <div key={pred.distanceName} className="prediction-item">
                <div className="prediction-heading">
                  <span className="prediction-distance">{formatDistanceName(pred.distanceName)}</span>
                  <div
                    className="prediction-help-anchor"
                    onMouseEnter={() => setOpenPredictionInfo(pred.distanceName)}
                    onMouseLeave={() => setOpenPredictionInfo(null)}
                    onFocus={() => setOpenPredictionInfo(pred.distanceName)}
                    onBlur={event => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenPredictionInfo(null);
                    }}
                  >
                    <button
                      type="button"
                      className="prediction-help"
                      aria-label={format(t.stats.predictionCompare, { distance: formatDistanceName(pred.distanceName) })}
                      aria-expanded={infoOpen}
                    >
                      <HelpCircle size={18} />
                    </button>
                    {infoOpen && (
                      <div className="prediction-benchmark" role="tooltip">
                        {benchmark ? (
                          <>
                            <strong>{format(t.stats.predictionGroup, {
                              age: benchmark.age,
                              gender: benchmark.sex === 'Male' ? t.stats.predictionMale : t.stats.predictionFemale
                            })}</strong>
                            <span>{benchmark.achievedLevel
                              ? format(t.stats.predictionLevel, {
                                  time: pred.timeFormatted ?? formatDuration(pred.timeSeconds),
                                  level: benchmarkLabels[levelIndex] ?? benchmark.achievedLevel,
                                  low: benchmark.levels[levelIndex].percentileFasterThan,
                                  high: benchmark.levels[levelIndex + 1]?.percentileFasterThan ?? 100
                                })
                              : format(t.stats.predictionBelow, { time: pred.timeFormatted ?? formatDuration(pred.timeSeconds) })}</span>
                            <strong>{t.stats.predictionTierRanges}</strong>
                            <div className="prediction-benchmark-rows">
                              {benchmark.levels.map((row, index) => (
                                <div key={row.level} className={row.level === benchmark.achievedLevel ? 'prediction-benchmark-current' : ''}>
                                  <span>{benchmarkLabels[index]}</span>
                                  <span>{benchmark.levels[index + 1]
                                    ? `${formatDuration(benchmark.levels[index + 1].timeSeconds)}–${formatDuration(row.timeSeconds)}`
                                    : format(t.stats.predictionFasterThanCutoff, { time: formatDuration(row.timeSeconds) })}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : <span>{t.stats.predictionProfileNeeded}</span>}
                        <span className="prediction-benchmark-note">{t.stats.predictionWeatherNote}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="prediction-time">{pred.timeFormatted}</div>
                <span className="prediction-pace">{t.stats.predictedPace}: {pred.paceFormatted}</span>
              </div>
            );
          })}
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
                title={t.stats.turnpointGuideTooltip}
                aria-label={t.stats.turnpointGuideTitle}
              >
                <HelpCircle size={14} />
              </button>
            </div>
            <Zap size={18} color="#06b6d4" />
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap', margin: '0.4rem 0' }}>
            <div className="goal-stat-highlight" style={{ color: '#06b6d4', fontSize: '1.4rem' }}>
              {turnpointGapSeconds !== null
                ? format(turnpointIsMeasured ? t.stats.gapSeconds : t.stats.estGapSeconds, { seconds: turnpointGapSeconds })
                : '--'}
            </div>
            {lt1?.lt1_pace_sec_km && lt2?.lt2_pace_sec_km && (
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '0.2rem 0.55rem',
                  borderRadius: 6,
                  color: turnpointCategory === 'optimal' ? '#10b981' : turnpointCategory === 'well' ? '#06b6d4' : '#f59e0b',
                  background: turnpointCategory === 'optimal' ? 'rgba(16, 185, 129, 0.15)' : turnpointCategory === 'well' ? 'rgba(6, 182, 212, 0.15)' : 'rgba(245, 158, 11, 0.15)'
                }}
              >
                {lt2.is_estimated
                  ? t.stats.turnpointEstimatedFromLt1
                  : turnpointCategory === 'optimal'
                    ? t.stats.turnpointOptimalAnchor
                    : turnpointCategory === 'well'
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
        <div className="modal-overlay turnpoint-guide-overlay" onClick={() => setIsMarginGuideOpen(false)}>
          <div className="modal-content turnpoint-guide-modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
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
                <div className="turnpoint-tier-list">
                  <div className={`turnpoint-tier-card elite ${turnpointTier === 'optimal' ? 'tier-current' : ''} ${turnpointTier === 'well' ? 'tier-target' : ''}`}>
                    <div className="turnpoint-tier-header">
                      <span className="turnpoint-tier-title">{t.stats.turnpointTierEliteTitle}</span>
                      <span className="turnpoint-tier-badge">{turnpointTier === 'well' ? t.economyGuide.nextTarget : t.stats.turnpointTierEliteBadge}</span>
                    </div>
                    <p className="turnpoint-tier-desc">
                      {t.stats.turnpointTierEliteDesc}
                    </p>
                  </div>

                  <div className={`turnpoint-tier-card well ${turnpointTier === 'well' ? 'tier-current' : ''} ${turnpointTier === 'base' ? 'tier-target' : ''}`}>
                    <div className="turnpoint-tier-header">
                      <span className="turnpoint-tier-title">{t.stats.turnpointTierWellTitle}</span>
                      <span className="turnpoint-tier-badge">{turnpointTier === 'base' ? t.economyGuide.nextTarget : t.stats.turnpointTierWellBadge}</span>
                    </div>
                    <p className="turnpoint-tier-desc">
                      {t.stats.turnpointTierWellDesc}
                    </p>
                  </div>

                  <div className={`turnpoint-tier-card developing ${turnpointTier === 'base' ? 'tier-current' : ''}`}>
                    <div className="turnpoint-tier-header">
                      <span className="turnpoint-tier-title">{t.stats.turnpointTierDevTitle}</span>
                      <span className="turnpoint-tier-badge">{t.stats.turnpointTierDevBadge}</span>
                    </div>
                    <p className="turnpoint-tier-desc">
                      {t.stats.turnpointTierDevDesc}
                    </p>
                  </div>
                </div>
              </div>

              <div className="turnpoint-current-card">
                <div className="turnpoint-current-header">
                  <h4>{t.stats.turnpointCurrentTitle}</h4>
                  {turnpointGapSeconds !== null && (
                    <span className={`turnpoint-current-badge ${turnpointTier ?? 'estimated'}`}>
                      {turnpointTier === 'optimal' ? t.stats.turnpointOptimalAnchor
                        : turnpointTier === 'well' ? t.stats.turnpointWellConditioned
                          : turnpointTier === 'base' ? t.stats.turnpointBaseOpportunity
                            : t.stats.turnpointEstimatedFromLt1}
                    </span>
                  )}
                </div>
                <div className="turnpoint-current-value">
                  {turnpointGapSeconds !== null
                    ? format(turnpointIsMeasured ? t.stats.gapSeconds : t.stats.estGapSeconds, { seconds: turnpointGapSeconds })
                    : t.stats.notCalibrated}
                </div>
                {lt1PaceSecKm != null && lt2PaceSecKm != null && (
                  <p className="turnpoint-current-desc">
                    {format(t.stats.paceGapCalc, {
                      easy: formatPace(lt1PaceSecKm),
                      threshold: formatPace(lt2PaceSecKm),
                      estimated: lt2?.is_estimated ? t.stats.estimatedSuffix : ''
                    })}
                  </p>
                )}
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
                  {t.stats.turnpointGotIt}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isMonthPickerOpen && (
        <div className="modal-overlay month-picker-overlay" onClick={() => setIsMonthPickerOpen(false)}>
          <section
            className="month-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t.stats.allRecentMonth}
            onClick={event => event.stopPropagation()}
          >
            <header className="month-picker-dialog-header">
              <h2>{t.stats.allRecentMonth}</h2>
              <button type="button" className="modal-close-btn" onClick={() => setIsMonthPickerOpen(false)} aria-label={t.common.close}>
                <X size={20} />
              </button>
            </header>
            <div className="month-picker-options">
              <button
                type="button"
                className={`month-picker-option ${selectedMonth === 'all' ? 'active' : ''}`}
                aria-pressed={selectedMonth === 'all'}
                onClick={() => { setSelectedMonth('all'); setIsMonthPickerOpen(false); }}
              >
                <span>{t.stats.allRecentMonth}</span>
                <span aria-hidden="true">{selectedMonth === 'all' ? '●' : '○'}</span>
              </button>
              {availableMonths.map(month => (
                <button
                  key={month.period}
                  type="button"
                  className={`month-picker-option ${selectedMonth === month.period ? 'active' : ''}`}
                  aria-pressed={selectedMonth === month.period}
                  onClick={() => { setSelectedMonth(month.period); setIsMonthPickerOpen(false); }}
                >
                  <span>{formatDate(`${month.period}-01`, { month: 'long', year: 'numeric' })}</span>
                  <span aria-hidden="true">{selectedMonth === month.period ? '●' : '○'}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
