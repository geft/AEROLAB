import React, { useState, useEffect } from 'react';
import { Target, Trophy, Flame, Activity, ShieldCheck, Zap, Calendar, TrendingUp, Clock, Mountain, HelpCircle, X, CheckCircle } from 'lucide-react';
import { formatPace } from '../utils/formatters.js';

export const StatsView: React.FC = () => {
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
  const vo2Max = data.latest?.vo2Max ?? 58;
  const zones = data.zones || {
    z1: [0, 134],
    z2: [135, 148],
    z3: [149, 166],
    z4: [167, 188],
    z5: [189, 203]
  };
  const lt1Hr = zones.z2[1] ?? data.currentThresholds?.lt1Hr ?? lt1?.lt1_hr ?? 148;
  const lt2Hr = zones.z4[0] ?? data.currentThresholds?.lt2Hr ?? lt2?.lt2_hr ?? 167;
  const lt1RangeStr = `${lt1Hr}`;

  return (
    <div className="stats-grid">
      {/* Aggregated Effort & Volume Breakdown (Weekly / Monthly / Yearly / All-Time) */}
      <section className="volume-analytics-card">
        <div className="volume-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span className="chart-title">Training Volume &amp; Effort Analytics</span>
              <span className="profile-sync-badge">
                <Calendar size={13} /> {volumeData?.periodLabel || 'Effort Aggregation'}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
              Aggregated mileage, total cardiovascular time, and physiological zone distribution (Zone 2 Aerobic Base vs Quality).
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
                <option value="all">All / Recent (30d)</option>
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
                Past 7 Days
              </button>
              <button
                className={`volume-tab-btn ${volumePeriod === 'month' ? 'active' : ''}`}
                onClick={() => setVolumePeriod('month')}
              >
                Monthly
              </button>
              <button
                className={`volume-tab-btn ${volumePeriod === 'year' ? 'active' : ''}`}
                onClick={() => setVolumePeriod('year')}
              >
                This Year
              </button>
              <button
                className={`volume-tab-btn ${volumePeriod === 'all' ? 'active' : ''}`}
                onClick={() => setVolumePeriod('all')}
              >
                All-Time
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
                <span className="volume-kpi-title">Total Distance</span>
                <div className="volume-kpi-val" style={{ color: '#06b6d4' }}>
                  {volumeData.totalDistanceKm} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>km</span>
                </div>
                <span className="volume-kpi-sub">{volumeData.activityCount} recorded runs</span>
              </div>

              <div className="volume-kpi-box">
                <span className="volume-kpi-title">Total Time</span>
                <div className="volume-kpi-val">
                  {volumeData.totalDurationHours} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>hrs</span>
                </div>
                <span className="volume-kpi-sub">Total cardiovascular time</span>
              </div>

              <div className="volume-kpi-box highlight">
                <span className="volume-kpi-title" style={{ color: '#10b981' }}>Zone 2 Aerobic Base</span>
                <div className="volume-kpi-val" style={{ color: '#10b981' }}>
                  {volumeData.zones?.z2?.hours || 0} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>hrs</span>
                </div>
                <span className="volume-kpi-sub">
                  <strong style={{ color: '#10b981' }}>{volumeData.zones?.z2?.pct || 0}%</strong> of total volume (sub-LT1)
                </span>
              </div>

              <div className="volume-kpi-box">
                <span className="volume-kpi-title">Quality / Threshold (Z4+Z5)</span>
                <div className="volume-kpi-val" style={{ color: '#f59e0b' }}>
                  {((volumeData.zones?.z4?.hours || 0) + (volumeData.zones?.z5?.hours || 0)).toFixed(1)} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>hrs</span>
                </div>
                <span className="volume-kpi-sub">
                  {(((volumeData.zones?.z4?.pct || 0) + (volumeData.zones?.z5?.pct || 0))).toFixed(1)}% high-intensity stimulus
                </span>
              </div>

              <div className="volume-kpi-box">
                <span className="volume-kpi-title">Elevation Gain</span>
                <div className="volume-kpi-val">
                  {volumeData.totalElevationGainM} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>m</span>
                </div>
                <span className="volume-kpi-sub">Vertical climbing meters</span>
              </div>
            </div>

            {/* Visual Zone Distribution Bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Time in Heart Rate Zones
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
      {/* Current Physiological Benchmarks */}
      <section className="benchmarks-grid">
        <div className="benchmark-card">
          <span className="benchmark-label">Aerobic Base (LT1)</span>
          <div className="benchmark-value" style={{ color: '#10b981' }}>
            {lt1?.lt1_pace_sec_km ? formatPace(lt1.lt1_pace_sec_km) : '5:10/km (Est.)'}
          </div>
          <span className="benchmark-sub">
            Ceiling HR: {lt1RangeStr} bpm
          </span>
          <div className="threshold-marker-badge">
            <ShieldCheck size={12} /> Bounded at LT1: {lt1RangeStr} bpm
          </div>
        </div>

        <div className="benchmark-card">
          <span className="benchmark-label">Lactate Threshold (LT2)</span>
          <div className="benchmark-value" style={{ color: '#f59e0b' }}>
            {lt2?.lt2_pace_sec_km ? formatPace(lt2.lt2_pace_sec_km) : '4:10/km (Est.)'}
          </div>
          <span className="benchmark-sub">
            Threshold HR: ~{lt2Hr} bpm
          </span>
          <div className="threshold-marker-badge amber">
            <Zap size={12} /> Turnpoint at LT2: {lt2Hr} bpm
          </div>
        </div>

        <div className="benchmark-card">
          <span className="benchmark-label">Estimated VO2 Max</span>
          <div className="benchmark-value" style={{ color: '#8b5cf6' }}>
            {vo2Max} <span style={{ fontSize: '1rem', color: '#94a3b8' }}>ml/kg/min</span>
          </div>
          <span className="benchmark-sub">Maximal oxygen uptake</span>
        </div>

        <div className="benchmark-card">
          <span className="benchmark-label">Baseline Running Economy</span>
          <div className="benchmark-value" style={{ color: '#06b6d4' }}>
            {lt1?.baseline_economy_ef ?? '1.14'}
          </div>
          <span className="benchmark-sub">Efficiency factor (speed / HR)</span>
        </div>
      </section>

      {/* Dynamic Calibrated Heart Rate Zones */}
      <section className="chart-card zones-section">
        <div className="chart-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span className="chart-title">Calibrated Heart Rate Zones (HRR Model)</span>
              <span className="profile-sync-badge">
                <Activity size={13} /> Continuous Auto-Calibration
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
              Derived from Karvonen HRR and live threshold calibrations.
            </p>
          </div>
        </div>

        {/* Proportional Zone Bar */}
        <div className="zone-visual-bar">
          <div className="zone-bar-segment" style={{ width: '20%', background: '#64748b' }}>
            Z1 Recovery (&lt;{zones.z2[0]})
          </div>
          <div className="zone-bar-segment" style={{ width: '25%', background: '#10b981' }}>
            Z2 Aerobic Base ({zones.z2[0]}–{zones.z2[1]})
          </div>
          <div className="zone-bar-segment" style={{ width: '22%', background: '#06b6d4' }}>
            Z3 Tempo ({zones.z3[0]}–{zones.z3[1]})
          </div>
          <div className="zone-bar-segment" style={{ width: '20%', background: '#f59e0b' }}>
            Z4 Threshold ({zones.z4[0]}–{zones.z4[1]})
          </div>
          <div className="zone-bar-segment" style={{ width: '13%', background: '#ef4444' }}>
            Z5 VO2 Max ({zones.z5[0]}+)
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
            <span className="zone-name">Active Recovery</span>
            <p className="zone-desc">
              Active warm-up, cooldown, and recovery flush.
            </p>
          </div>

          {/* Zone 2 */}
          <div className="zone-card zone-highlight">
            <div className="zone-card-header">
              <span className="zone-tag" style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#10b981' }}>Zone 2</span>
              <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>Easy Base</span>
            </div>
            <div className="zone-range" style={{ color: '#10b981' }}>{zones.z2[0]} – {zones.z2[1]} <span style={{ fontSize: '0.85rem' }}>bpm</span></div>
            <span className="zone-name">Aerobic Base &amp; Endurance</span>
            <p className="zone-desc">
              Fat oxidation and capillary network growth.
            </p>
          </div>

          {/* Zone 3 */}
          <div className="zone-card">
            <div className="zone-card-header">
              <span className="zone-tag" style={{ background: 'rgba(6, 182, 212, 0.2)', color: '#06b6d4' }}>Zone 3</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>70–80% HRR</span>
            </div>
            <div className="zone-range" style={{ color: '#06b6d4' }}>{zones.z3[0]} – {zones.z3[1]} <span style={{ fontSize: '0.85rem' }}>bpm</span></div>
            <span className="zone-name">Tempo &amp; Aerobic Drift</span>
            <p className="zone-desc">
              Steady aerobic rhythm and marathon pace.
            </p>
          </div>

          {/* Zone 4 */}
          <div className="zone-card">
            <div className="zone-card-header">
              <span className="zone-tag" style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b' }}>Zone 4</span>
              <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600 }}>Threshold</span>
            </div>
            <div className="zone-range" style={{ color: '#f59e0b' }}>{zones.z4[0]} – {zones.z4[1]} <span style={{ fontSize: '0.85rem' }}>bpm</span></div>
            <span className="zone-name">Lactate Threshold / LT2</span>
            <p className="zone-desc">
              1-hour race pace and lactate clearance.
            </p>
          </div>

          {/* Zone 5 */}
          <div className="zone-card">
            <div className="zone-card-header">
              <span className="zone-tag" style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}>Zone 5</span>
              <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>&gt; 90% HRR</span>
            </div>
            <div className="zone-range" style={{ color: '#ef4444' }}>{zones.z5[0]}+ <span style={{ fontSize: '0.85rem' }}>bpm</span></div>
            <span className="zone-name">VO2 Max &amp; Anaerobic</span>
            <p className="zone-desc">
              Peak aerobic power and fast intervals.
            </p>
          </div>
        </div>
      </section>

      {/* Race Predictions Table */}
      <section className="chart-card">
        <div className="chart-header">
          <div>
            <span className="chart-title">Race Time Predictions</span>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.2rem' }}>
              Modeled from your LT1 and LT2 aerobic profile.
            </p>
          </div>
        </div>

        <div className="predictions-grid">
          {data.predictions?.map((pred: any) => (
            <div key={pred.distanceName} className="prediction-item">
              <span className="prediction-distance">{pred.distanceName}</span>
              <div className="prediction-time">{pred.timeFormatted}</div>
              <span className="prediction-pace">Target Pace: {pred.paceFormatted}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Polarized Training Distribution Guide */}
      <section className="goal-markers-grid">
        <div className="goal-card">
          <div className="goal-card-header">
            <span className="goal-card-title">80/20 Polarized Balance</span>
            <Target size={18} color="#10b981" />
          </div>
          <div className="goal-stat-highlight" style={{ color: '#10b981', fontSize: '1.4rem' }}>
            82% Low / 18% High
          </div>
          <p className="goal-stat-desc">
            Optimal distribution: easy volume below LT1 preserves freshness for quality threshold sessions.
          </p>
        </div>

        <div className="goal-card">
          <div className="goal-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span className="goal-card-title">Aerobic Turnpoint Margin</span>
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
                ? `${Math.round(lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km)}s gap` 
                : '60s gap'}
            </div>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '0.2rem 0.55rem',
                borderRadius: 6,
                color: (lt1?.lt1_pace_sec_km && lt2?.lt2_pace_sec_km && (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km) <= 50) ? '#10b981' : (lt1?.lt1_pace_sec_km && lt2?.lt2_pace_sec_km && (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km) <= 70) ? '#06b6d4' : '#f59e0b',
                background: (lt1?.lt1_pace_sec_km && lt2?.lt2_pace_sec_km && (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km) <= 50) ? 'rgba(16, 185, 129, 0.15)' : (lt1?.lt1_pace_sec_km && lt2?.lt2_pace_sec_km && (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km) <= 70) ? 'rgba(6, 182, 212, 0.15)' : 'rgba(245, 158, 11, 0.15)'
              }}
            >
              {(lt1?.lt1_pace_sec_km && lt2?.lt2_pace_sec_km && (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km) <= 50)
                ? 'Optimal Anchor (≤ 50s)'
                : (lt1?.lt1_pace_sec_km && lt2?.lt2_pace_sec_km && (lt1.lt1_pace_sec_km - lt2.lt2_pace_sec_km) <= 70)
                  ? 'Well-Conditioned (50–70s)'
                  : 'Base Opportunity (> 70s)'}
            </span>
          </div>

          <p className="goal-stat-desc">
            Pace gap between Easy ({lt1?.lt1_pace_sec_km ? formatPace(lt1.lt1_pace_sec_km) : '5:50/km'}) and Threshold ({lt2?.lt2_pace_sec_km ? formatPace(lt2.lt2_pace_sec_km) : '4:10/km'}). Narrows as aerobic fitness improves.
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
                <h2 className="modal-title" style={{ color: 'var(--text-primary)' }}>Aerobic Turnpoint Margin Guide</h2>
              </div>
              <button className="modal-close-btn" onClick={() => setIsMarginGuideOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '0.5rem 0' }}>
              <div>
                <h4 style={{ color: 'var(--text-primary)', margin: '0 0 0.4rem 0', fontSize: '0.95rem' }}>
                  What is the Aerobic Turnpoint Margin?
                </h4>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
                  The <b>Aerobic Turnpoint Margin</b> is the pace spread between your <b>Aerobic Base (LT1)</b> and your <b>Lactate Threshold (LT2)</b>. In endurance physiology (e.g. Stephen Seiler, Olbrecht, Maffetone), it measures how well-developed your lipid oxidation and mitochondrial capillary foundation are relative to your maximum 1-hour sustained velocity.
                </p>
              </div>

              {/* Target Benchmark Tiers */}
              <div>
                <h4 style={{ color: 'var(--text-primary)', margin: '0 0 0.6rem 0', fontSize: '0.88rem' }}>
                  Target Benchmarks &amp; Standards
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <div style={{ padding: '0.75rem', borderRadius: 8, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#10b981' }}>35–50s/km Gap — Elite / Highly Developed Base</span>
                      <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>Optimal Anchor</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
                      LT1 is pulled extremely close to LT2 (LT1 speed is ~85–90% of LT2). Characteristic of high-mileage marathoners who can cruise comfortably at high aerobic speeds with zero lactate accumulation.
                    </p>
                  </div>

                  <div style={{ padding: '0.75rem', borderRadius: 8, background: 'rgba(6, 182, 212, 0.08)', border: '1px solid rgba(6, 182, 212, 0.25)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#06b6d4' }}>50–70s/km Gap — Well-Conditioned Base</span>
                      <span style={{ fontSize: '0.72rem', color: '#06b6d4', fontWeight: 600 }}>Healthy Target</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
                      Healthy aerobic balance for committed amateur runners and marathoners. Easy runs stay restorative while supporting quality threshold work.
                    </p>
                  </div>

                  <div style={{ padding: '0.75rem', borderRadius: 8, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#f59e0b' }}>&gt; 75s/km Gap — Developing Aerobic Base</span>
                      <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600 }}>Room for Expansion</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
                      Indicates Aerobic Deficiency Syndrome (ADS). Easy pace lags far behind threshold capability because fat oxidation enzymes and slow-twitch capillary density are still adapting.
                    </p>
                  </div>
                </div>
              </div>

              {/* Your Current Status & Training Direction */}
              <div style={{ padding: '0.85rem', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                <h4 style={{ color: 'var(--text-primary)', margin: '0 0 0.4rem 0', fontSize: '0.85rem' }}>
                  How to Optimize Your Margin:
                </h4>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  <li><b>If your gap is &gt; 70s</b>: Increase weekly mileage strictly below LT1 (&lt; 148 bpm). Avoid the temptation to run easy days too fast; true Zone 2 miles trigger mitochondrial biogenesis that pulls LT1 pace faster without raising heart rate.</li>
                  <li><b>If your gap is &lt; 45s</b>: Your aerobic base is well-developed! To run faster, introduce quality LT2 threshold intervals (e.g. 3x15min in Zone 4) to lift your anaerobic ceiling higher.</li>
                </ul>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className="save-profile-btn"
                  style={{ width: 'auto', padding: '0.45rem 1.25rem', fontSize: '0.82rem' }}
                  onClick={() => setIsMarginGuideOpen(false)}
                >
                  Got It
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

