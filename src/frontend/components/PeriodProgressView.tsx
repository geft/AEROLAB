import React, { useState, useEffect } from 'react';
import { Calendar, TrendingUp, Award, Activity, ShieldCheck, Zap, LayoutGrid, List, ArrowUpRight } from 'lucide-react';
import { formatPace } from '../utils/formatters.js';

export interface PeriodSummary {
  period: string; // "2026-09" or "2026"
  label: string; // "Sep 2026" or "2026 Season"
  runCount: number;
  totalDistanceKm: number;
  totalDurationHours: number;
  totalElevationM?: number;
  avgEfficiencyFactor: number | null;
  avgPaceSecKm: number | null;
  avgHeartRate: number | null;
  zone2Hours?: number;
  zone2Pct?: number;
  activeMonths?: number;
  calibrations?: any[];
}

export const PeriodProgressView: React.FC = () => {
  const [data, setData] = useState<{ months: PeriodSummary[]; years: PeriodSummary[] } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [activePeriodType, setActivePeriodType] = useState<'month' | 'year'>('month');
  const [runTypeFilter, setRunTypeFilter] = useState<'all' | 'easy' | 'threshold'>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/activities/progress-history?run_type=${runTypeFilter}`)
      .then(res => res.json())
      .then(resData => {
        setData(resData);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load progress history:', err);
        setLoading(false);
      });
  }, [runTypeFilter]);

  if (loading || !data) {
    return (
      <div className="period-progress-card">
        <div className="loading-skeleton" style={{ height: 320, borderRadius: 12 }}></div>
      </div>
    );
  }

  const periods = (activePeriodType === 'month' ? data.months : data.years) || [];

  // Chart calculation metrics
  const maxDistance = periods.length > 0 ? Math.max(...periods.map(p => p.totalDistanceKm), 10) : 10;
  const efValues = periods.map(p => p.avgEfficiencyFactor).filter((ef): ef is number => ef !== null);
  const minEf = efValues.length > 0 ? Math.min(...efValues, 1.0) : 1.0;
  const maxEf = efValues.length > 0 ? Math.max(...efValues, 1.3) : 1.3;
  const efSpan = Math.max(0.1, maxEf - minEf);

  const colWidth = periods.length > 12 ? 66 : periods.length > 6 ? 74 : 110;
  const paddingLeft = 55;
  const paddingRight = 55;
  const paddingTop = 25;
  const paddingBottom = 46;
  const chartWidth = Math.max(840, periods.length * colWidth + paddingLeft + paddingRight);
  const chartHeight = 236;
  const innerWidth = chartWidth - paddingLeft - paddingRight;
  const innerHeight = chartHeight - paddingTop - paddingBottom;

  const getX = (idx: number) => {
    if (periods.length <= 1) return paddingLeft + innerWidth / 2;
    return paddingLeft + (idx / (periods.length - 1)) * innerWidth;
  };

  const getBarHeight = (distKm: number) => {
    return (distKm / maxDistance) * innerHeight;
  };

  const getY_EF = (ef: number) => {
    const norm = (ef - minEf) / efSpan;
    return paddingTop + innerHeight - norm * innerHeight;
  };

  // Build SVG path for EF line
  const efPoints = periods
    .map((p, idx) => {
      if (p.avgEfficiencyFactor === null) return null;
      return { x: getX(idx), y: getY_EF(p.avgEfficiencyFactor), ef: p.avgEfficiencyFactor, period: p };
    })
    .filter((pt): pt is { x: number; y: number; ef: number; period: PeriodSummary } => pt !== null);

  const efLinePath = efPoints.length > 1
    ? efPoints.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x},${pt.y}`, '')
    : '';

  // Baseline comparison
  const baselineEf = data.months?.[0]?.avgEfficiencyFactor || 1.06;
  const latestMonthEf = (data.months && data.months.length > 0)
    ? (data.months[data.months.length - 1]?.avgEfficiencyFactor || 1.16)
    : 1.16;
  const efficiencyImprovementPct = baselineEf > 0
    ? (((latestMonthEf - baselineEf) / baselineEf) * 100).toFixed(1)
    : '0';

  return (
    <section className="period-progress-container">
      <div className="period-header-row">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
            <span className="chart-title">Progress Over Month &amp; Year</span>
            <span className="profile-sync-badge">
              <Calendar size={13} /> Longitudinal Evolution
            </span>
            <span className="run-badge badge-easy_base" style={{ fontSize: '0.72rem' }}>
              <TrendingUp size={11} style={{ marginRight: 3 }} /> +{efficiencyImprovementPct}% Economy Gain in 2026
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            Compare your monthly volume progression (km) alongside the steady improvement in cardiovascular Running Economy (EF) across training blocks.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* Run Type Filter Pills */}
          <div className="filter-pills">
            <button
              className={`filter-pill-btn ${runTypeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setRunTypeFilter('all')}
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem' }}
            >
              All Runs
            </button>
            <button
              className={`filter-pill-btn ${runTypeFilter === 'easy' ? 'active' : ''}`}
              onClick={() => setRunTypeFilter('easy')}
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem' }}
            >
              Easy / Base
            </button>
            <button
              className={`filter-pill-btn ${runTypeFilter === 'threshold' ? 'active' : ''}`}
              onClick={() => setRunTypeFilter('threshold')}
              style={{ fontSize: '0.72rem', padding: '0.2rem 0.55rem' }}
            >
              Threshold / VO2
            </button>
          </div>

          {/* Month / Year Switcher */}
          <div className="volume-tabs">
            <button
              className={`volume-tab-btn ${activePeriodType === 'month' ? 'active' : ''}`}
              onClick={() => setActivePeriodType('month')}
            >
              Monthly
            </button>
            <button
              className={`volume-tab-btn ${activePeriodType === 'year' ? 'active' : ''}`}
              onClick={() => setActivePeriodType('year')}
            >
              Yearly
            </button>
          </div>

          {/* Cards / Table Switcher */}
          <div className="view-mode-toggle">
            <button
              className={`view-mode-btn ${viewMode === 'cards' ? 'active' : ''}`}
              onClick={() => setViewMode('cards')}
              title="Milestone Cards"
            >
              <LayoutGrid size={13} style={{ marginRight: 3, verticalAlign: 'middle' }} />
              Cards
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              title="Table View"
            >
              <List size={13} style={{ marginRight: 3, verticalAlign: 'middle' }} />
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Dual Metric Progression Chart (Volume Bars + EF Line) */}
      <div className="period-chart-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(6, 182, 212, 0.6)' }}></span>
              <span>Total Distance (km)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              <span style={{ width: 14, height: 3, borderRadius: 2, background: '#10b981' }}></span>
              <span>Running Economy (EF)</span>
            </div>
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Hover over bars to inspect period metrics
          </span>
        </div>

        <div className="svg-chart-wrapper" style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            style={{ width: '100%', minWidth: `${Math.min(chartWidth, Math.max(760, periods.length * 60))}px`, height: 'auto', maxHeight: 280, display: 'block' }}
          >
            <defs>
              <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#0891b2" stopOpacity="0.25" />
              </linearGradient>
              <linearGradient id="barGradientHover" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#0284c7" stopOpacity="0.45" />
              </linearGradient>
            </defs>

            {/* Horizontal Gridlines */}
            {[0, 0.33, 0.66, 1].map((ratio, i) => {
              const y = paddingTop + innerHeight * (1 - ratio);
              const distVal = Math.round(maxDistance * ratio);
              return (
                <g key={i}>
                  <line
                    x1={paddingLeft}
                    y1={y}
                    x2={chartWidth - paddingRight}
                    y2={y}
                    stroke="rgba(255, 255, 255, 0.08)"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={paddingLeft - 8}
                    y={y + 4}
                    fill="var(--text-muted)"
                    fontSize="10"
                    textAnchor="end"
                  >
                    {distVal} km
                  </text>
                </g>
              );
            })}

            {/* Right Y-Axis: EF Scale */}
            {[minEf, minEf + efSpan / 2, maxEf].map((ef, i) => {
              const y = getY_EF(ef);
              return (
                <text
                  key={i}
                  x={chartWidth - paddingRight + 8}
                  y={y + 4}
                  fill="#10b981"
                  fontSize="10"
                  textAnchor="start"
                  fontWeight="600"
                >
                  {ef.toFixed(2)} EF
                </text>
              );
            })}

            {/* Volume Bars */}
            {periods.map((p, idx) => {
              const xCenter = getX(idx);
              const barW = Math.min(38, Math.max(20, (innerWidth / periods.length) * 0.45));
              const barH = getBarHeight(p.totalDistanceKm);
              const barY = paddingTop + innerHeight - barH;
              const isHovered = hoveredIndex === idx;

              // Format top-of-bar distance (round >= 100km to avoid wide text overflow)
              const formattedDistKm = p.totalDistanceKm >= 100
                ? `${Math.round(p.totalDistanceKm)}k`
                : `${p.totalDistanceKm}k`;

              // Separate month from year in Month view to prevent cramped collisions
              const isMonthView = activePeriodType === 'month';
              let primaryLabel = p.label;
              let yearBadge: string | null = null;

              if (isMonthView && p.period && p.period.includes('-')) {
                const [yr, mo] = p.period.split('-');
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const mIdx = parseInt(mo, 10) - 1;
                primaryLabel = monthNames[mIdx] || p.label;
                const prevYr = idx > 0 ? periods[idx - 1]?.period?.split('-')[0] : null;
                const isYearStart = idx === 0 || yr !== prevYr;
                if (isYearStart) {
                  yearBadge = yr;
                }
              }

              return (
                <g
                  key={p.period}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Invisible touch trigger */}
                  <rect
                    x={xCenter - barW}
                    y={paddingTop}
                    width={barW * 2}
                    height={innerHeight + paddingBottom}
                    fill="transparent"
                  />

                  {/* Volume Bar */}
                  <rect
                    x={xCenter - barW / 2}
                    y={barY}
                    width={barW}
                    height={Math.max(4, barH)}
                    rx={4}
                    fill={isHovered ? 'url(#barGradientHover)' : 'url(#barGradient)'}
                    stroke={isHovered ? '#38bdf8' : '#06b6d4'}
                    strokeWidth={isHovered ? 1.5 : 0.8}
                  />

                  {/* Bar Value on Top */}
                  <text
                    x={xCenter}
                    y={barY - 6}
                    fill={isHovered ? '#38bdf8' : 'var(--text-secondary)'}
                    fontSize="10"
                    fontWeight="600"
                    textAnchor="middle"
                  >
                    {formattedDistKm}
                  </text>

                  {/* X-Axis Period Label (Clean 3-letter month or season title) */}
                  <text
                    x={xCenter}
                    y={paddingTop + innerHeight + 16}
                    fill={isHovered ? 'var(--text-primary)' : 'var(--text-secondary)'}
                    fontSize="11"
                    fontWeight={isHovered ? '700' : '600'}
                    textAnchor="middle"
                  >
                    {primaryLabel}
                  </text>

                  {/* Secondary Line: Year transition marker or run count */}
                  {yearBadge ? (
                    <text
                      x={xCenter}
                      y={paddingTop + innerHeight + 28}
                      fill="#38bdf8"
                      fontSize="9"
                      fontWeight="700"
                      textAnchor="middle"
                    >
                      {yearBadge}
                    </text>
                  ) : (
                    <text
                      x={xCenter}
                      y={paddingTop + innerHeight + 28}
                      fill="var(--text-muted)"
                      fontSize="9"
                      textAnchor="middle"
                    >
                      {p.runCount} {p.runCount === 1 ? 'run' : 'runs'}
                    </text>
                  )}

                  {/* Tertiary Line: Run count when Year transition marker is active */}
                  {yearBadge && (
                    <text
                      x={xCenter}
                      y={paddingTop + innerHeight + 39}
                      fill="var(--text-muted)"
                      fontSize="8.5"
                      textAnchor="middle"
                    >
                      {p.runCount} {p.runCount === 1 ? 'run' : 'runs'}
                    </text>
                  )}
                </g>
              );
            })}

            {/* EF Trendline */}
            {efLinePath && (
              <path
                d={efLinePath}
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* EF Data Points */}
            {efPoints.map((pt, idx) => {
              const isHovered = hoveredIndex === idx;
              return (
                <g key={idx}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isHovered ? 6 : 4}
                    fill="#10b981"
                    stroke="var(--bg-card)"
                    strokeWidth="2"
                    style={{ transition: 'r 0.15s ease' }}
                  />
                  {/* Subtle point value if hovered or endpoints */}
                  {(isHovered || idx === 0 || idx === efPoints.length - 1) && (
                    <text
                      x={pt.x}
                      y={pt.y - 10}
                      fill="#10b981"
                      fontSize="10.5"
                      fontWeight="700"
                      textAnchor="middle"
                    >
                      {pt.ef.toFixed(2)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Detail Breakdown: Cards or Table */}
      {viewMode === 'cards' ? (
        <div className="period-cards-grid">
          {periods.map((p, idx) => {
            const hasCalibrations = (p.calibrations?.length ?? 0) > 0;
            const isLatest = idx === periods.length - 1;

            return (
              <div
                key={p.period}
                className={`period-milestone-card ${isLatest ? 'highlighted-period' : ''}`}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <div className="period-card-header">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Calendar size={15} color="#06b6d4" />
                      <span className="period-title">{p.label}</span>
                      {isLatest && (
                        <span className="run-badge badge-easy_base" style={{ fontSize: '0.65rem' }}>
                          Current Block
                        </span>
                      )}
                    </div>
                    <span className="period-subtitle">
                      {p.runCount} logged {p.runCount === 1 ? 'activity' : 'activities'}
                      {p.activeMonths ? ` across ${p.activeMonths} active months` : ''}
                    </span>
                  </div>

                  <div className="period-volume-badge">
                    <span className="volume-val">{p.totalDistanceKm}</span>
                    <span className="volume-unit">km</span>
                  </div>
                </div>

                <div className="period-metrics-grid">
                  <div className="period-metric-box">
                    <span className="period-metric-label">Running Economy</span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                      <span className="period-metric-num" style={{ color: '#10b981' }}>
                        {p.avgEfficiencyFactor ? p.avgEfficiencyFactor.toFixed(2) : '—'}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>EF</span>
                    </div>
                    <span className="period-metric-sub">Meters / heartbeat</span>
                  </div>

                  <div className="period-metric-box">
                    <span className="period-metric-label">Total Time</span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                      <span className="period-metric-num">
                        {p.totalDurationHours}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>hrs</span>
                    </div>
                    <span className="period-metric-sub">
                      {p.zone2Hours ? `Zone 2: ${p.zone2Hours}h (${p.zone2Pct}%)` : 'Total cardio'}
                    </span>
                  </div>

                  <div className="period-metric-box">
                    <span className="period-metric-label">Average Pace</span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                      <span className="period-metric-num" style={{ color: '#38bdf8' }}>
                        {formatPace(p.avgPaceSecKm)}
                      </span>
                    </div>
                    <span className="period-metric-sub">
                      Avg HR: {p.avgHeartRate ? `${p.avgHeartRate} bpm` : '—'}
                    </span>
                  </div>
                </div>

                {hasCalibrations && (() => {
                  const lt2Cals = p.calibrations?.filter(c => !!c.lt2_pace_sec_km) ?? [];
                  const lt1Cals = p.calibrations?.filter(c => !!c.lt1_pace_sec_km && !c.lt2_pace_sec_km) ?? [];
                  // Best (fastest) pace = lowest sec/km
                  const bestLt2 = lt2Cals.length > 0
                    ? lt2Cals.reduce((a, b) => (a.lt2_pace_sec_km ?? 999) < (b.lt2_pace_sec_km ?? 999) ? a : b)
                    : null;
                  const bestLt1 = lt1Cals.length > 0
                    ? lt1Cals.reduce((a, b) => (a.lt1_pace_sec_km ?? 999) < (b.lt1_pace_sec_km ?? 999) ? a : b)
                    : null;
                  const totalCals = (p.calibrations?.length ?? 0);

                  return (
                    <div className="period-calibrations-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.4rem' }}>
                        <Award size={13} color="#f59e0b" />
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                          {totalCals} Physiological Calibration{totalCals !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                        {bestLt2 && (
                          <span
                            className="run-badge badge-threshold_lt2"
                            style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}
                            title={`Best LT2 Threshold pace this period across ${lt2Cals.length} calibration${lt2Cals.length !== 1 ? 's' : ''}`}
                          >
                            LT2 Peak: {formatPace(bestLt2.lt2_pace_sec_km)}/km
                            {lt2Cals.length > 1 && <span style={{ opacity: 0.65, marginLeft: '0.3rem' }}>×{lt2Cals.length}</span>}
                          </span>
                        )}
                        {bestLt1 && (
                          <span
                            className="run-badge badge-easy_base"
                            style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}
                            title={`Best LT1 Aerobic Base pace this period across ${lt1Cals.length} calibration${lt1Cals.length !== 1 ? 's' : ''}`}
                          >
                            LT1 Base: {formatPace(bestLt1.lt1_pace_sec_km)}/km
                            {lt1Cals.length > 1 && <span style={{ opacity: 0.65, marginLeft: '0.3rem' }}>×{lt1Cals.length}</span>}
                          </span>
                        )}
                        {!bestLt2 && !bestLt1 && (
                          <span className="run-badge badge-race" style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }}>
                            Benchmark Effort
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="styled-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Activities</th>
                <th>Distance</th>
                <th>Duration</th>
                <th>Aerobic Economy (EF)</th>
                <th>Average Pace</th>
                <th>Average HR</th>
                <th>Zone 2 Aerobic Foundation</th>
                <th>Calibrated Milestones</th>
              </tr>
            </thead>
            <tbody>
              {periods.map(p => (
                <tr key={p.period}>
                  <td><b>{p.label}</b></td>
                  <td>{p.runCount}</td>
                  <td style={{ color: '#06b6d4', fontWeight: 600 }}>{p.totalDistanceKm} km</td>
                  <td>{p.totalDurationHours} hrs</td>
                  <td style={{ color: '#10b981', fontWeight: 700 }}>
                    {p.avgEfficiencyFactor ? p.avgEfficiencyFactor.toFixed(2) : '—'} EF
                  </td>
                  <td style={{ color: '#38bdf8' }}>{formatPace(p.avgPaceSecKm)}</td>
                  <td>{p.avgHeartRate ? `${p.avgHeartRate} bpm` : '—'}</td>
                  <td>{p.zone2Hours ? `${p.zone2Hours}h (${p.zone2Pct}%)` : '—'}</td>
                  <td>
                    {p.calibrations && p.calibrations.length > 0 ? (
                      <span className="run-badge badge-easy_base" style={{ fontSize: '0.7rem' }}>
                        {p.calibrations.length} {p.calibrations.length === 1 ? 'calibration' : 'calibrations'}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
