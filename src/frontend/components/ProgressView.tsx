import React, { useState, useEffect } from 'react';
import { TrendingUp, Activity, Compass, Zap, ShieldCheck, Calendar, List, LayoutGrid, Award } from 'lucide-react';
import { getDisplayTitle } from './BrowseView';
import { PeriodProgressView } from './PeriodProgressView';
import { ThresholdTrendsChart } from './ThresholdTrendsChart';
import { EconomyGuideModal } from './EconomyGuideModal';
import { VdotGuideModal } from './VdotGuideModal';
import { formatPace, formatDate } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { translateCalibrationNote, translateActivityName } from '../i18n/coachTranslator.js';

interface ThresholdData {
  latest: {
    lt1: { lt1_hr: number; lt1_pace_sec_km: number; effective_date: string; baseline_economy_ef: number } | null;
    lt2: { lt2_hr: number; lt2_pace_sec_km: number; effective_date: string } | null;
    vo2Max: number;
  };
  currentThresholds?: any;
  zones?: any;
  predictions: any[];
  history: any[];
  economyTrend: any[];
  scatterData: any[];
}

export const ProgressView: React.FC = () => {
  const { t, language } = useTranslation();
  const [data, setData] = useState<ThresholdData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [historyViewMode, setHistoryViewMode] = useState<'cards' | 'table'>('cards');
  const [calFilter, setCalFilter] = useState<'all' | 'lt1' | 'lt2' | 'race'>('all');
  const [isEconomyGuideOpen, setIsEconomyGuideOpen] = useState<boolean>(false);
  const [isVdotGuideOpen, setIsVdotGuideOpen] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/thresholds')
      .then(res => res.json())
      .then(resData => {
        setData(resData);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load thresholds:', err);
        setLoading(false);
      });
  }, []);

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
  }, [data?.history]);

  const filteredHistory = React.useMemo(() => {
    return uniqueHistory.filter(h => {
      const isLt2 = !!h.lt2_pace_sec_km;
      const isRace = h.notes?.toLowerCase().includes('race') || h.activity_name?.toLowerCase().includes('time trial');
      if (calFilter === 'lt1') return !isLt2 && !isRace;
      if (calFilter === 'lt2') return isLt2 && !isRace;
      if (calFilter === 'race') return isRace;
      return true;
    });
  }, [uniqueHistory, calFilter]);

  if (loading || !data) {
    return (
      <div className="progress-grid">
        <div className="overview-card loading-skeleton" style={{ height: 400 }}></div>
      </div>
    );
  }

  return (
    <div className="progress-grid">
      {/* Overview Cards */}
      <div className="benchmarks-grid">
        <div className="benchmark-card">
          <span className="benchmark-label">{t.progress.lt1Title}</span>
          <div className="benchmark-value" style={{ color: '#10b981' }}>
            {data.latest.lt1?.lt1_pace_sec_km ? formatPace(data.latest.lt1.lt1_pace_sec_km) : '5:10/km (Est.)'}
          </div>
          <span className="benchmark-sub">
            {t.progress.lt1Sub} ({data.zones?.z2?.[1] ?? data.currentThresholds?.lt1Hr ?? data.latest.lt1?.lt1_hr ?? 145} bpm)
          </span>
          <div className="threshold-marker-badge">
            <ShieldCheck size={12} /> {t.progress.zone2Ceiling}: {data.zones?.z2?.[1] ?? data.currentThresholds?.lt1Hr ?? data.latest.lt1?.lt1_hr ?? 145} bpm
          </div>
        </div>

        <div className="benchmark-card">
          <span className="benchmark-label">{t.progress.lt2Title}</span>
          <div className="benchmark-value" style={{ color: '#f59e0b' }}>
            {data.latest.lt2?.lt2_pace_sec_km ? `${formatPace(data.latest.lt2.lt2_pace_sec_km)}${(data.latest.lt2 as any)?.is_estimated ? ' (Est.)' : ''}` : '--'}
          </div>
          <span className="benchmark-sub">
            {t.progress.lt2Sub} (~{data.zones?.z4?.[0] ?? data.currentThresholds?.lt2Hr ?? data.latest.lt2?.lt2_hr ?? 167} bpm)
          </span>
          <div className="threshold-marker-badge amber">
            <Zap size={12} /> {t.stats.anaerobicThreshold}: {data.zones?.z4?.[0] ?? data.currentThresholds?.lt2Hr ?? data.latest.lt2?.lt2_hr ?? 167} bpm
          </div>
        </div>

        <div className="benchmark-card" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="benchmark-label">{t.progress.vdotTrend}</span>
            <button
              type="button"
              onClick={() => setIsVdotGuideOpen(true)}
              className="info-circle-btn"
              title="What is VDOT & VO2 Max? View equivalent race paces"
              aria-label="What is VDOT & VO2 Max?"
            >
              ?
            </button>
          </div>
          <div className="benchmark-value" style={{ color: '#8b5cf6' }}>
            {data.latest.vo2Max ?? 58} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>ml/kg/min</span>
          </div>
          <span className="benchmark-sub">{t.stats.predictedPace}</span>
        </div>

        <div className="benchmark-card" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="benchmark-label">{t.progress.economyIndex}</span>
            <button
              type="button"
              onClick={() => setIsEconomyGuideOpen(true)}
              className="info-circle-btn"
              title="What is Running Economy? View benchmark tiers"
              aria-label="What is Running Economy?"
            >
              ?
            </button>
          </div>
          <div className="benchmark-value" style={{ color: '#06b6d4' }}>
            {data.latest.lt1?.baseline_economy_ef ? Number(data.latest.lt1.baseline_economy_ef).toFixed(2) : '1.15'}
          </div>
          <span className="benchmark-sub">{t.browse.metersPerBeat}</span>
        </div>
      </div>

      {/* Physiological Threshold Anchors Banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '1rem 1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ShieldCheck size={20} color="#10b981" />
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.progress.liveCalibrations}: LT1 @ {data.zones?.z2?.[1] ?? data.currentThresholds?.lt1Hr ?? 145} bpm • LT2 @ {data.zones?.z4?.[0] ?? data.currentThresholds?.lt2Hr ?? 167} bpm
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {t.progress.liveCalibrationsDesc}
            </div>
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
                {filteredHistory.length} of {uniqueHistory.length}
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {t.progress.subtitle}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
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
                title="Organized Milestone Cards"
              >
                <LayoutGrid size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                {t.progress.cardsView}
              </button>
              <button
                className={`view-mode-btn ${historyViewMode === 'table' ? 'active' : ''}`}
                onClick={() => setHistoryViewMode('table')}
                title="Data Table View"
              >
                <List size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                {t.progress.tableView}
              </button>
            </div>
          </div>
        </div>

        <div className="calibration-scroll-container">
          {historyViewMode === 'cards' ? (
            <div className="calibration-timeline">
              {filteredHistory.map((h, idx) => {
                const isLt2 = !!h.lt2_pace_sec_km;
                const isRace = h.notes?.toLowerCase().includes('race') || h.activity_name?.toLowerCase().includes('time trial');
                const cardClass = isRace ? 'race-card' : (isLt2 ? 'lt2-card' : 'lt1-card');
                const distKm = h.distance_meters ? (h.distance_meters / 1000).toFixed(1) : null;

              return (
                <div key={h.id || idx} className={`calibration-milestone-card ${cardClass}`}>
                  <div className="calibration-card-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <Calendar size={14} color="#94a3b8" />
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {formatDate(h.effective_date)}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>•</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {translateActivityName(h.activity_name || (language === 'zh' ? '校准跑步' : 'Calibration Run'), language)} {distKm ? `(${distKm} km)` : ''}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="run-badge badge-easy_base" style={{ fontSize: '0.68rem' }}>
                        {(h.confidence * 100).toFixed(0)}% {t.progress.confidence}
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
                            ~{h.lt2_hr || 167} <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>bpm</span>
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
                            ~{h.lt1_hr || 136} <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>bpm</span>
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
                      "{translateCalibrationNote(h.notes, language)}"
                    </div>
                  )}
                </div>
              );
            })}

            {uniqueHistory.length === 0 && (
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
                {filteredHistory.map((h, i) => (
                  <tr key={h.id || i}>
                    <td><b>{formatDate(h.effective_date)}</b></td>
                    <td>{translateActivityName(h.activity_name || (language === 'zh' ? '平稳校准跑' : 'Steady calibration run'), language)}</td>
                    <td style={{ color: '#10b981', fontWeight: 600 }}>{formatPace(h.lt1_pace_sec_km)}</td>
                    <td>{h.lt1_hr ? `${h.lt1_hr} bpm` : '—'}</td>
                    <td style={{ color: '#f59e0b', fontWeight: 600 }}>{formatPace(h.lt2_pace_sec_km)}</td>
                    <td>{h.lt2_hr ? `${h.lt2_hr} bpm` : '—'}</td>
                    <td><span className="run-badge badge-easy_base">{(h.confidence * 100).toFixed(0)}%</span></td>
                    <td style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{translateCalibrationNote(h.notes, language)}</td>
                  </tr>
                ))}

                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', color: '#64748b', padding: '2rem' }}>
                      No threshold calibrations match the selected filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </section>

      <EconomyGuideModal
        isOpen={isEconomyGuideOpen}
        onClose={() => setIsEconomyGuideOpen(false)}
        currentEf={data.latest.lt1?.baseline_economy_ef ?? 1.15}
        lt1Hr={data.zones?.z2?.[1] ?? data.currentThresholds?.lt1Hr ?? data.latest.lt1?.lt1_hr ?? 150}
        lt2Hr={data.zones?.z4?.[0] ?? data.currentThresholds?.lt2Hr ?? data.latest.lt2?.lt2_hr ?? 165}
      />

      <VdotGuideModal
        isOpen={isVdotGuideOpen}
        onClose={() => setIsVdotGuideOpen(false)}
        currentVdot={data.latest.vo2Max ?? 58}
      />
    </div>
  );
};
