import React, { useState, useEffect } from 'react';
import { TrendingUp, Activity, Compass, Zap, ShieldCheck, Calendar, List, LayoutGrid, Award } from 'lucide-react';
import { getDisplayTitle } from './BrowseView';
import { PeriodProgressView } from './PeriodProgressView';
import { EconomyGuideModal } from './EconomyGuideModal';
import { VdotGuideModal } from './VdotGuideModal';
import { formatPace, formatDate } from '../utils/formatters.js';

interface ThresholdData {
  latest: {
    lt1: { lt1_hr: number; lt1_pace_sec_km: number; effective_date: string; baseline_economy_ef: number } | null;
    lt2: { lt2_hr: number; lt2_pace_sec_km: number; effective_date: string } | null;
    vo2Max: number;
  };
  currentThresholds?: any;
  predictions: any[];
  history: any[];
  economyTrend: any[];
  scatterData: any[];
}

export const ProgressView: React.FC = () => {
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
          <span className="benchmark-label">Aerobic Threshold (LT1) Pace</span>
          <div className="benchmark-value" style={{ color: '#10b981' }}>
            {data.latest.lt1?.lt1_pace_sec_km ? formatPace(data.latest.lt1.lt1_pace_sec_km) : '5:10/km (Est.)'}
          </div>
          <span className="benchmark-sub">
            Calibrated at {data.zones?.z2?.[1] ?? data.currentThresholds?.lt1Hr ?? data.latest.lt1?.lt1_hr ?? 145} bpm (Zone 2 Ceiling)
          </span>
          <div className="threshold-marker-badge">
            <ShieldCheck size={12} /> Zone 2 Ceiling: {data.zones?.z2?.[1] ?? data.currentThresholds?.lt1Hr ?? data.latest.lt1?.lt1_hr ?? 145} bpm
          </div>
        </div>

        <div className="benchmark-card">
          <span className="benchmark-label">Lactate Threshold (LT2) Pace</span>
          <div className="benchmark-value" style={{ color: '#f59e0b' }}>
            {data.latest.lt2?.lt2_pace_sec_km ? formatPace(data.latest.lt2.lt2_pace_sec_km) : '4:10/km (Est.)'}
          </div>
          <span className="benchmark-sub">
            Anaerobic Turnpoint (~{data.zones?.z4?.[0] ?? data.currentThresholds?.lt2Hr ?? data.latest.lt2?.lt2_hr ?? 167} bpm)
          </span>
          <div className="threshold-marker-badge amber">
            <Zap size={12} /> Zone 4 Turnpoint: {data.zones?.z4?.[0] ?? data.currentThresholds?.lt2Hr ?? data.latest.lt2?.lt2_hr ?? 167} bpm
          </div>
        </div>

        <div className="benchmark-card" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="benchmark-label">Estimated VO2 Max / VDOT</span>
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
          <span className="benchmark-sub">Aerobic Engine Potential</span>
        </div>

        <div className="benchmark-card" style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="benchmark-label">Running Economy Index</span>
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
          <span className="benchmark-sub">Meters Traveled Per Heartbeat</span>
        </div>
      </div>

      {/* Physiological Threshold Anchors Banner */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: '1rem 1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ShieldCheck size={20} color="#10b981" />
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Live Calibrations: LT1 @ {data.zones?.z2?.[1] ?? data.currentThresholds?.lt1Hr ?? 145} bpm • LT2 @ {data.zones?.z4?.[0] ?? data.currentThresholds?.lt2Hr ?? 167} bpm
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Thresholds and training zones calibrate automatically from your runs.
            </div>
          </div>
        </div>
        <div className="profile-sync-badge">
          <Activity size={13} /> Synchronized with Athlete Profile
        </div>
      </div>

      {/* Monthly & Yearly Longitudinal Progress Overview */}
      <PeriodProgressView />

      {/* Reorganized Historical Threshold Progression Milestones */}
      <section className="data-table-card">
        <div className="sidebar-header" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Award size={18} color="#06b6d4" />
              <span className="sidebar-title">Historical Threshold Calibrations</span>
              <span className="calibration-count-badge">
                {filteredHistory.length} of {uniqueHistory.length}
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Timeline of recalibrations detected across your runs.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            {/* Type Filter Pills */}
            <div className="calibration-filter-pills">
              <button
                className={`cal-filter-btn ${calFilter === 'all' ? 'active' : ''}`}
                onClick={() => setCalFilter('all')}
              >
                All
              </button>
              <button
                className={`cal-filter-btn ${calFilter === 'lt1' ? 'active' : ''}`}
                onClick={() => setCalFilter('lt1')}
              >
                LT1 Base
              </button>
              <button
                className={`cal-filter-btn ${calFilter === 'lt2' ? 'active' : ''}`}
                onClick={() => setCalFilter('lt2')}
              >
                LT2 Threshold
              </button>
              <button
                className={`cal-filter-btn ${calFilter === 'race' ? 'active' : ''}`}
                onClick={() => setCalFilter('race')}
              >
                Race Benchmark
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
                Milestones
              </button>
              <button
                className={`view-mode-btn ${historyViewMode === 'table' ? 'active' : ''}`}
                onClick={() => setHistoryViewMode('table')}
                title="Data Table View"
              >
                <List size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Table
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
                        {h.activity_name || 'Calibration Run'} {distKm ? `(${distKm} km)` : ''}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="run-badge badge-easy_base" style={{ fontSize: '0.68rem' }}>
                        {(h.confidence * 100).toFixed(0)}% Confidence
                      </span>
                      <span className={`run-badge ${isRace ? 'badge-race' : (isLt2 ? 'badge-threshold_lt2' : 'badge-easy_base')}`}>
                        {isRace ? 'Race Benchmark' : (isLt2 ? 'LT2 Threshold' : 'LT1 Aerobic Base')}
                      </span>
                    </div>
                  </div>

                  <div className="calibration-metrics-row">
                    {isLt2 ? (
                      <>
                        <div className="calibration-metric-item">
                          <span className="calibration-metric-label">Lactate Threshold (LT2) Pace</span>
                          <span className="calibration-metric-val" style={{ color: '#f59e0b' }}>
                            {formatPace(h.lt2_pace_sec_km)}
                          </span>
                        </div>
                        <div className="calibration-metric-item">
                          <span className="calibration-metric-label">Threshold Heart Rate</span>
                          <span className="calibration-metric-val" style={{ color: '#f59e0b' }}>
                            ~{h.lt2_hr || 167} <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>bpm</span>
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="calibration-metric-item">
                          <span className="calibration-metric-label">Aerobic Base (LT1) Pace</span>
                          <span className="calibration-metric-val" style={{ color: '#10b981' }}>
                            {formatPace(h.lt1_pace_sec_km)}
                          </span>
                        </div>
                        <div className="calibration-metric-item">
                          <span className="calibration-metric-label">Aerobic Heart Rate</span>
                          <span className="calibration-metric-val" style={{ color: '#10b981' }}>
                            ~{h.lt1_hr || 136} <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>bpm</span>
                          </span>
                        </div>
                      </>
                    )}

                    <div className="calibration-metric-item">
                      <span className="calibration-metric-label">Baseline Economy</span>
                      <span className="calibration-metric-val" style={{ color: '#06b6d4' }}>
                        {h.baseline_economy_ef ? Number(h.baseline_economy_ef).toFixed(2) : '—'} <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>EF</span>
                      </span>
                    </div>
                  </div>

                  {h.notes && (
                    <div className="calibration-card-note">
                      "{h.notes}"
                    </div>
                  )}
                </div>
              );
            })}

            {uniqueHistory.length === 0 && (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b', fontSize: '0.85rem' }}>
                Thresholds will automatically record here after your first steady Zone 2 or threshold run.
              </div>
            )}
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="styled-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Run Source</th>
                  <th>LT1 (Aerobic) Pace</th>
                  <th>LT1 Heart Rate</th>
                  <th>LT2 (Threshold) Pace</th>
                  <th>LT2 Heart Rate</th>
                  <th>Confidence</th>
                  <th>Calibration Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((h, i) => (
                  <tr key={h.id || i}>
                    <td><b>{formatDate(h.effective_date)}</b></td>
                    <td>{h.activity_name || 'Steady calibration run'}</td>
                    <td style={{ color: '#10b981', fontWeight: 600 }}>{formatPace(h.lt1_pace_sec_km)}</td>
                    <td>{h.lt1_hr ? `${h.lt1_hr} bpm` : '—'}</td>
                    <td style={{ color: '#f59e0b', fontWeight: 600 }}>{formatPace(h.lt2_pace_sec_km)}</td>
                    <td>{h.lt2_hr ? `${h.lt2_hr} bpm` : '—'}</td>
                    <td><span className="run-badge badge-easy_base">{(h.confidence * 100).toFixed(0)}%</span></td>
                    <td style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{h.notes}</td>
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
      />

      <VdotGuideModal
        isOpen={isVdotGuideOpen}
        onClose={() => setIsVdotGuideOpen(false)}
        currentVdot={data.latest.vo2Max ?? 58}
      />
    </div>
  );
};
