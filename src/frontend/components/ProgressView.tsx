import { useActivityRevision } from '../features/activity-revision.js';
import React, { useState, useEffect } from 'react';
import type { ThresholdsResponse, CalibrationHistoryItem } from '../types/api.js';
import { TrendingUp, Activity, Zap, ShieldCheck, Calendar, List, LayoutGrid, Award, RefreshCw } from 'lucide-react';
import { PeriodProgressView } from './PeriodProgressView';
import { ThresholdTrendsChart } from './ThresholdTrendsChart';
import { EconomyGuideModal } from './EconomyGuideModal';
import { VdotGuideModal } from './VdotGuideModal';
import { formatPace } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { translateCalibrationNote, translateActivityName } from '../i18n/coachTranslator.js';
import { getThresholds } from '../api/client.js';
import { Lt1Reassessment } from './Lt1Reassessment.js';

interface ThresholdData {
  latest: {
    lt1: { lt1_hr: number; lt1_pace_sec_km: number; effective_date: string; baseline_economy_ef: number } | null;
    lt2: { lt2_hr: number; lt2_pace_sec_km: number; effective_date: string; is_estimated?: boolean | null } | null;
    vo2Max: number;
  };
  currentThresholds?: ThresholdsResponse['currentThresholds'];
  zones?: ThresholdsResponse['zones'];
  predictions: ThresholdsResponse['predictions'];
  history: CalibrationHistoryItem[];
  economyTrend: ThresholdsResponse['economyTrend'];
  scatterData: ThresholdsResponse['scatterData'];
}

export const ProgressView: React.FC = () => {
  const { t, format, formatDate, language } = useTranslation();

  // Date.now() must not be called during render (react-hooks/purity), so capture a
  // stable "now" once per mount for the time-range fallback.
  const [mountedAt] = React.useState(() => Date.now());
  const revision = useActivityRevision();
  const [data, setData] = useState<ThresholdData | null>(null);
  const [completedRequest, setCompletedRequest] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const request = [retryCount, revision].join(':');
  const loading = completedRequest !== request;
  const [historyViewMode, setHistoryViewMode] = useState<'cards' | 'table'>('cards');
  const [calFilter, setCalFilter] = useState<'all' | 'lt1' | 'lt2' | 'race'>('all');
  const [isEconomyGuideOpen, setIsEconomyGuideOpen] = useState<boolean>(false);
  const [isVdotGuideOpen, setIsVdotGuideOpen] = useState<boolean>(false);
  const [historyRange, setHistoryRange] = useState<'3m' | '6m' | '12m' | 'all'>('6m');
  const [visibleHistoryCount, setVisibleHistoryCount] = useState<number>(10);

  useEffect(() => {
    let cancelled = false;
    getThresholds()
      .then(resData => {
        if (cancelled) return;
        setLoadError(false);
        // The route always returns `latest`; the view's stricter local shape
        // mirrors that guarantee rather than the optional contract field.
        setData(resData as unknown as ThresholdData);
        setCompletedRequest(request);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load thresholds:', err);
        setLoadError(true);
        setCompletedRequest(request);
      });
    return () => { cancelled = true; };
  }, [request]);

  // Deduplicate history entries by source_activity_id to eliminate repetitive rows
  const uniqueHistory = React.useMemo(() => {
    if (!data?.history) return [];
    const seen = new Set<string>();
    return data.history.filter(h => {
      const key = h.source_activity_id ? `act_${h.source_activity_id}` : `id_${h.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data]);

  const filteredHistory = React.useMemo(() => {
    const typeFiltered = uniqueHistory.filter(h => {
      const isLt2 = !!h.lt2_pace_sec_km;
      const isRace = h.activity_run_type === 'race';
      if (calFilter === 'lt1') return !isLt2 && !isRace;
      if (calFilter === 'lt2') return isLt2 && !isRace;
      if (calFilter === 'race') return isRace;
      return true;
    });

    if (historyRange === 'all') return typeFiltered;

    const latestTime = uniqueHistory.length > 0
      ? new Date(uniqueHistory[0].effective_date.replace(' ', 'T')).getTime()
      : mountedAt;
    const cutoffDays = historyRange === '3m' ? 92 : historyRange === '6m' ? 184 : 365;
    const cutoffMs = latestTime - cutoffDays * 24 * 3600 * 1000;

    return typeFiltered.filter(h => {
      const t = new Date(h.effective_date.replace(' ', 'T')).getTime();
      return t >= cutoffMs;
    });
  }, [uniqueHistory, calFilter, historyRange, mountedAt]);

  const paginatedHistory = React.useMemo(() => {
    return filteredHistory.slice(0, visibleHistoryCount);
  }, [filteredHistory, visibleHistoryCount]);

  if (loading) {
    return (
      <div className="progress-grid">
        <div className="overview-card loading-skeleton" style={{ height: 400 }}></div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="load-error-state" role="alert">
        <p>{t.progress.loadFailed}</p>
        <button type="button" className="outline-btn" onClick={() => setRetryCount(count => count + 1)}>
          <RefreshCw size={14} /> {t.common.retry}
        </button>
      </div>
    );
  }

  const pred5k = data.predictions?.find((p: ThresholdsResponse['predictions'][number]) => p.distanceName === '5K');
  const lt1Range = data.currentThresholds?.lt1Range;
  const lt1Display = lt1Range && lt1Range[0] !== lt1Range[1]
    ? `${lt1Range[0]}–${lt1Range[1]}` : String(data.currentThresholds?.lt1Hr ?? '—');

  return (
    <div className="progress-grid">
      {/* Overview Cards */}
      <div className="benchmarks-grid">
        <div className="benchmark-card">
          <div className="benchmark-card-main">
            <span className="benchmark-label">{t.progress.lt1Title}</span>
            <div className="benchmark-value" style={{ color: '#10b981' }}>
              {formatPace(data.currentThresholds?.lt1PaceSecKm ?? data.latest.lt1?.lt1_pace_sec_km)}
            </div>
            <span className="benchmark-sub">
              {t.progress.lt1Sub}
              {data.currentThresholds?.lt1Evidence && <><br />{t.stats.thresholdEvidenceStatus[data.currentThresholds.lt1Evidence.status]}{data.currentThresholds.lt1Evidence.basis === 'run_walk' && <><br />{t.stats.runWalkEvidence}</>}</>}
            </span>
          </div>
          <div className="threshold-marker-badge">
            <ShieldCheck size={12} /> {t.progress.zone2Ceiling}: {lt1Display} bpm
          </div>
        </div>

        <div className="benchmark-card">
          <div className="benchmark-card-main">
            <span className="benchmark-label">{t.progress.lt2Title}</span>
            <div className="benchmark-value" style={{ color: '#f59e0b' }}>
              {data.latest.lt2?.lt2_pace_sec_km ? (data.latest.lt2.is_estimated ? format(t.progress.estimatedPace, { pace: formatPace(data.latest.lt2.lt2_pace_sec_km) }) : formatPace(data.latest.lt2.lt2_pace_sec_km)) : '--'}
            </div>
            <span className="benchmark-sub">
              {t.progress.lt2Sub}
              {data.currentThresholds?.lt2Evidence && <><br />{t.stats.thresholdEvidenceStatus[data.currentThresholds.lt2Evidence.status]}</>}
            </span>
          </div>
          <div className="threshold-marker-badge amber">
            <Zap size={12} /> {t.progress.zone4Threshold}: ~{data.currentThresholds?.lt2Hr ?? data.latest.lt2?.lt2_hr ?? data.zones?.z4?.[1] ?? '—'} bpm
          </div>
        </div>

        <div className="benchmark-card" style={{ position: 'relative' }}>
          <div className="benchmark-card-main">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="benchmark-label">{t.progress.vdotTrend}</span>
              <button
                type="button"
                onClick={() => setIsVdotGuideOpen(true)}
                className="info-circle-btn"
                title={t.progress.vdotGuideTitle}
                aria-label={t.progress.vdotGuideAria}
              >
                ?
              </button>
            </div>
            <div className="benchmark-value" style={{ color: '#8b5cf6' }}>
              {data.latest.vo2Max ?? '—'} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>ml/kg/min</span>
            </div>
            <span className="benchmark-sub">{t.progress.vdotSub}</span>
          </div>
          <div className="threshold-marker-badge purple">
            <TrendingUp size={12} /> {pred5k?.timeFormatted ? `${t.progress.predicted5k}: ~${pred5k.timeFormatted}` : t.progress.vdotRacingIndex}
          </div>
        </div>

        <div className="benchmark-card" style={{ position: 'relative' }}>
          <div className="benchmark-card-main">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="benchmark-label">{t.progress.economyIndex}</span>
              <button
                type="button"
                onClick={() => setIsEconomyGuideOpen(true)}
                className="info-circle-btn"
                title={t.progress.economyGuideTitle}
                aria-label={t.progress.economyGuideAria}
              >
                ?
              </button>
            </div>
            <div className="benchmark-value" style={{ color: '#06b6d4' }}>
              {data.currentThresholds?.baselineEconomyEf != null
                ? Number(data.currentThresholds.baselineEconomyEf).toFixed(2)
                : data.latest.lt1?.baseline_economy_ef != null
                  ? Number(data.latest.lt1.baseline_economy_ef).toFixed(2)
                  : '—'}
            </div>
            <span className="benchmark-sub">{t.browse.efficiencyFactor}</span>
          </div>
          <div className="threshold-marker-badge cyan">
            <Activity size={12} /> {t.progress.cardioEfficiency}
          </div>
        </div>
      </div>

      {data.currentThresholds?.lt1Assessment && <Lt1Reassessment assessment={data.currentThresholds.lt1Assessment} />}

      {/* Physiological Threshold Anchors Banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '1rem 1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ShieldCheck size={20} color="#10b981" />
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.progress.liveCalibrations}: {format(t.progress.liveCalibrationsValues, { lt1: lt1Display, lt2: data.currentThresholds?.lt2Hr ?? data.latest.lt2?.lt2_hr ?? '—' })}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t.progress.liveCalibrationsDesc}
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.4rem 0 0', maxWidth: '65ch' }}>
              {t.progress.thresholdEstimateNote}
            </p>
          </div>
        </div>
        <div className="profile-sync-badge">
          <Activity size={13} /> {t.progress.syncWithProfile}
        </div>
      </div>

      {/* Physiological Threshold Trends (LT1 & LT2) */}
      <ThresholdTrendsChart
        history={data.history}
        currentThresholds={data.currentThresholds}
      />

      {/* Monthly & Yearly Longitudinal Progress Overview */}
      <PeriodProgressView />

      {/* Reorganized Historical Threshold Progression Milestones */}
      <section className="data-table-card">
        <div className="sidebar-header" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Award size={18} color="#06b6d4" />
              <span className="sidebar-title">{t.progress.benchmarksTitle}</span>
              <span className="calibration-count-badge">
                {format(t.progress.displayedCount, { shown: filteredHistory.length, total: uniqueHistory.length })}
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {t.progress.subtitle}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            {/* Time Range Filter Pills */}
            <div className="filter-pills" style={{ display: 'flex', background: 'var(--bg-card-subtle, rgba(255,255,255,0.05))', borderRadius: 8, padding: 2 }}>
              <button
                className={`filter-pill-btn ${historyRange === '3m' ? 'active' : ''}`}
                onClick={() => { setHistoryRange('3m'); setVisibleHistoryCount(10); }}
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', borderRadius: 6 }}
              >
                {t.progress.range3m}
              </button>
              <button
                className={`filter-pill-btn ${historyRange === '6m' ? 'active' : ''}`}
                onClick={() => { setHistoryRange('6m'); setVisibleHistoryCount(15); }}
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', borderRadius: 6 }}
              >
                {t.progress.range6m}
              </button>
              <button
                className={`filter-pill-btn ${historyRange === '12m' ? 'active' : ''}`}
                onClick={() => { setHistoryRange('12m'); setVisibleHistoryCount(20); }}
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', borderRadius: 6 }}
              >
                {format(t.common.monthsShort, { count: 12 })}
              </button>
              <button
                className={`filter-pill-btn ${historyRange === 'all' ? 'active' : ''}`}
                onClick={() => setHistoryRange('all')}
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', borderRadius: 6 }}
              >
                {t.progress.rangeAll}
              </button>
            </div>

            {/* Type Filter Pills */}
            <div className="calibration-filter-pills">
              <button
                className={`cal-filter-btn ${calFilter === 'all' ? 'active' : ''}`}
                onClick={() => setCalFilter('all')}
              >
                {t.progress.filterAll}
              </button>
              <button
                className={`cal-filter-btn ${calFilter === 'lt1' ? 'active' : ''}`}
                onClick={() => setCalFilter('lt1')}
              >
                {t.progress.filterLt1}
              </button>
              <button
                className={`cal-filter-btn ${calFilter === 'lt2' ? 'active' : ''}`}
                onClick={() => setCalFilter('lt2')}
              >
                {t.progress.filterLt2}
              </button>
              <button
                className={`cal-filter-btn ${calFilter === 'race' ? 'active' : ''}`}
                onClick={() => setCalFilter('race')}
              >
                {t.progress.filterRace}
              </button>
            </div>

            {/* View Mode Toggle */}
            <div className="view-mode-toggle">
              <button
                className={`view-mode-btn ${historyViewMode === 'cards' ? 'active' : ''}`}
                onClick={() => setHistoryViewMode('cards')}
                title={t.progress.milestoneCardsTooltip}
              >
                <LayoutGrid size={13} />
                {t.progress.cardsView}
              </button>
              <button
                className={`view-mode-btn ${historyViewMode === 'table' ? 'active' : ''}`}
                onClick={() => setHistoryViewMode('table')}
                title={t.progress.tableTooltip}
              >
                <List size={13} />
                {t.progress.tableView}
              </button>
            </div>
          </div>
        </div>

        <div className="calibration-scroll-container">
          {historyViewMode === 'cards' ? (
            <div className="calibration-timeline">
              {paginatedHistory.map((h, idx) => {
                const isLt2 = !!h.lt2_pace_sec_km;
                const isRace = h.activity_run_type === 'race';
                const cardClass = isRace ? 'race-card' : (isLt2 ? 'lt2-card' : 'lt1-card');
                const distKm = h.distance_meters ? (h.distance_meters / 1000).toFixed(1) : null;

              return (
                <div key={h.id || idx} className={`calibration-milestone-card ${cardClass}`}>
                  <div className="calibration-card-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <Calendar size={14} color="#94a3b8" />
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {formatDate(h.effective_date, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>•</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {translateActivityName(h.activity_name || t.progressExtras.calibrationRun, language, t.browse.coachLegacyTemplates)} {distKm ? `(${distKm} km)` : ''}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="run-badge badge-easy_base" style={{ fontSize: '0.68rem' }}>
                        {((h.confidence ?? 0) * 100).toFixed(0)}% {t.progress.confidence}
                      </span>
                      <span className={`run-badge ${isRace ? 'badge-race' : (isLt2 ? 'badge-threshold_lt2' : 'badge-easy_base')}`}>
                        {isRace ? t.progress.raceBenchmark : (isLt2 ? t.progress.lt2ThresholdBadge : t.progress.lt1AerobicBaseBadge)}
                      </span>
                    </div>
                  </div>

                  <div className="calibration-metrics-row">
                    {isLt2 ? (
                      <>
                        <div className="calibration-metric-item">
                          <span className="calibration-metric-label">{t.progress.lt2PaceLabel}</span>
                          <span className="calibration-metric-val" style={{ color: '#f59e0b' }}>
                            {formatPace(h.lt2_pace_sec_km)}
                          </span>
                        </div>
                        <div className="calibration-metric-item">
                          <span className="calibration-metric-label">{t.progress.thresholdHrLabel}</span>
                          <span className="calibration-metric-val" style={{ color: '#f59e0b' }}>
                            ~{h.lt2_hr ?? '—'} <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>bpm</span>
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="calibration-metric-item">
                          <span className="calibration-metric-label">{t.progress.lt1PaceLabel}</span>
                          <span className="calibration-metric-val" style={{ color: '#10b981' }}>
                            {formatPace(h.lt1_pace_sec_km)}
                          </span>
                        </div>
                        <div className="calibration-metric-item">
                          <span className="calibration-metric-label">{t.progress.aerobicHrLabel}</span>
                          <span className="calibration-metric-val" style={{ color: '#10b981' }}>
                            ~{h.lt1_hr ?? '—'} <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>bpm</span>
                          </span>
                        </div>
                      </>
                    )}

                    <div className="calibration-metric-item">
                      <span className="calibration-metric-label">{t.progress.baselineEconomyLabel}</span>
                      <span className="calibration-metric-val" style={{ color: '#06b6d4' }}>
                        {h.baseline_economy_ef ? Number(h.baseline_economy_ef).toFixed(2) : '—'} <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>EF</span>
                      </span>
                    </div>
                  </div>

                  {h.notes && (
                    <div className="calibration-card-note">
                      {format(t.common.quotedText, { text: translateCalibrationNote(h.notes ?? '', language) })}
                    </div>
                  )}
                </div>
              );
            })}

            {filteredHistory.length === 0 && (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b', fontSize: '0.85rem' }}>
                {t.progress.noThresholdsYet}
              </div>
            )}
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="styled-table">
              <thead>
                <tr>
                  <th>{t.progress.tableDate}</th>
                  <th>{t.progress.tableRunSource}</th>
                  <th>{t.progress.tableLt1Pace}</th>
                  <th>{t.progress.tableLt1Hr}</th>
                  <th>{t.progress.tableLt2Pace}</th>
                  <th>{t.progress.tableLt2Hr}</th>
                  <th>{t.progress.tableConfidence}</th>
                  <th>{t.progress.tableCalibrationNote}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedHistory.map((h, i) => (
                  <tr key={h.id || i}>
                    <td><b>{formatDate(h.effective_date, { month: 'short', day: 'numeric', year: 'numeric' })}</b></td>
                    <td>{translateActivityName(h.activity_name || t.progressExtras.steadyCalibrationRun, language, t.browse.coachLegacyTemplates)}</td>
                    <td style={{ color: '#10b981', fontWeight: 600 }}>{formatPace(h.lt1_pace_sec_km)}</td>
                    <td>{h.lt1_hr ? `${h.lt1_hr} bpm` : '—'}</td>
                    <td style={{ color: '#f59e0b', fontWeight: 600 }}>{formatPace(h.lt2_pace_sec_km)}</td>
                    <td>{h.lt2_hr ? `${h.lt2_hr} bpm` : '—'}</td>
                    <td><span className="run-badge badge-easy_base">{((h.confidence ?? 0) * 100).toFixed(0)}%</span></td>
                    <td style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{translateCalibrationNote(h.notes ?? '', language)}</td>
                  </tr>
                ))}

                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                      {t.progress.noCalibrations}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Milestone Pagination Footer */}
        {filteredHistory.length > paginatedHistory.length && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginTop: '1.25rem', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="primary-btn"
              style={{ fontSize: '0.82rem', padding: '0.45rem 1rem' }}
              onClick={() => setVisibleHistoryCount(prev => Math.min(filteredHistory.length, prev + 10))}
            >
              {format(t.progressExtras.loadMoreCalibrations, { shown: paginatedHistory.length, total: filteredHistory.length })}
            </button>
            <button
              type="button"
              className="outline-btn"
              style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
              onClick={() => setVisibleHistoryCount(filteredHistory.length)}
            >
              {format(t.progressExtras.showAllFiltered, { count: filteredHistory.length })}
            </button>
          </div>
        )}
        </div>
      </section>

      <EconomyGuideModal
        isOpen={isEconomyGuideOpen}
        onClose={() => setIsEconomyGuideOpen(false)}
        currentEf={data.latest.lt1?.baseline_economy_ef ?? null}
        lt1Hr={data.zones?.z2?.[1] ?? data.currentThresholds?.lt1Hr ?? data.latest.lt1?.lt1_hr ?? null}
        lt2Hr={data.zones?.z4?.[0] ?? data.currentThresholds?.lt2Hr ?? data.latest.lt2?.lt2_hr ?? null}
      />

      <VdotGuideModal
        isOpen={isVdotGuideOpen}
        onClose={() => setIsVdotGuideOpen(false)}
        currentVdot={data.latest.vo2Max ?? null}
      />
    </div>
  );
};
