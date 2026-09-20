import React, { useState, useMemo, useCallback } from 'react';
import { Clock, Heart, TrendingUp } from 'lucide-react';
import { formatPace, formatDate } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { translateActivityName, translateCalibrationNote } from '../i18n/coachTranslator.js';
import { rollingThreshold } from '../../shared/threshold-trend.js';

export interface CalibrationHistoryItem {
  id?: number;
  source_activity_id?: string;
  effective_date: string;
  lt1_hr: number | null;
  lt1_pace_sec_km: number | null;
  lt2_hr: number | null;
  lt2_pace_sec_km: number | null;
  confidence: number;
  notes?: string;
  activity_name?: string;
  distance_meters?: number;
  duration_seconds?: number;
}

interface ThresholdTrendsChartProps {
  history: CalibrationHistoryItem[];
  currentThresholds?: {
    lt1Hr: number;
    lt2Hr: number;
    lt1PaceSecKm: number | null;
    lt2PaceSecKm: number | null;
    confidence: number;
    source: string;
  };
}

export const ThresholdTrendsChart: React.FC<ThresholdTrendsChartProps> = ({
  history,
  currentThresholds
}) => {
  const { t, language } = useTranslation();

  // Date.now() must not be called during render (react-hooks/purity), so capture a
  // stable "now" once per mount for the time-range fallback.
  const [mountedAt] = useState(() => Date.now());
  const [metric, setMetric] = useState<'pace' | 'hr'>('pace');
  const [timeRange, setTimeRange] = useState<'3m' | '6m' | '12m' | 'all'>('6m');
  const [showIndividualRuns, setShowIndividualRuns] = useState(false);
  const [hoveredPoint, setHoveredPoint] = useState<{
    type: 'lt1' | 'lt2';
    item: CalibrationHistoryItem;
    x: number;
    y: number;
  } | null>(null);

  // 1. Deduplicate & sort chronologically (oldest -> newest)
  const sortedHistory = useMemo(() => {
    if (!history) return [];
    const seen = new Set<string>();
    const unique = history.filter(h => {
      const key = h.source_activity_id ? `act_${h.source_activity_id}` : `id_${h.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique.sort((a, b) => {
      const ta = new Date(a.effective_date.replace(' ', 'T')).getTime();
      const tb = new Date(b.effective_date.replace(' ', 'T')).getTime();
      return ta - tb;
    });
  }, [history]);

  // Compute from the complete history before filtering: changing the viewport
  // must not change the estimate at a date visible in both ranges.
  const trendHistory = useMemo(() => {
    if (showIndividualRuns) return sortedHistory;
    const observations = (type: 'lt1' | 'lt2') => sortedHistory
      .filter(h => h[`${type}_hr`] != null)
      .map(h => ({ hr: h[`${type}_hr`]!, pace: h[`${type}_pace_sec_km`],
        confidence: h.confidence, effective_date: h.effective_date }));
    const lt1 = observations('lt1'), lt2 = observations('lt2');
    return sortedHistory.map(h => {
      const a = h.lt1_hr != null ? rollingThreshold(lt1, h.effective_date) : null;
      const b = h.lt2_hr != null ? rollingThreshold(lt2, h.effective_date) : null;
      return { ...h, lt1_hr: a?.hr ?? h.lt1_hr, lt1_pace_sec_km: a?.pace ?? h.lt1_pace_sec_km,
        lt2_hr: b?.hr ?? h.lt2_hr, lt2_pace_sec_km: b?.pace ?? h.lt2_pace_sec_km,
        confidence: a?.confidence ?? b?.confidence ?? h.confidence,
        activity_name: undefined, notes: undefined };
    });
  }, [sortedHistory, showIndividualRuns]);

  // 2. Filter by time range
  const filteredHistory = useMemo(() => {
    if (timeRange === 'all') return trendHistory;
    const latestTime = sortedHistory.length > 0
      ? new Date(sortedHistory[sortedHistory.length - 1].effective_date.replace(' ', 'T')).getTime()
      : mountedAt;
    const cutoffDays = timeRange === '3m' ? 92 : timeRange === '6m' ? 184 : 365;
    const cutoffMs = latestTime - cutoffDays * 24 * 3600 * 1000;
    return trendHistory.filter(h => {
      const t = new Date(h.effective_date.replace(' ', 'T')).getTime();
      return t >= cutoffMs;
    });
  }, [sortedHistory, trendHistory, timeRange, mountedAt]);

  // 3. Extract series points
  const lt1Points = useMemo(() => {
    return filteredHistory.filter(h =>
      metric === 'pace' ? (h.lt1_pace_sec_km && h.lt1_pace_sec_km > 0) : (h.lt1_hr && h.lt1_hr > 0)
    );
  }, [filteredHistory, metric]);

  const lt2Points = useMemo(() => {
    return filteredHistory.filter(h =>
      metric === 'pace' ? (h.lt2_pace_sec_km && h.lt2_pace_sec_km > 0) : (h.lt2_hr && h.lt2_hr > 0)
    );
  }, [filteredHistory, metric]);

  // Chart Dimensions
  const width = 860;
  const height = 280;
  const padLeft = 65;
  const padRight = 45;
  const padTop = 30;
  const padBottom = 45;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  // Timeline extent
  const { minTime, maxTime } = useMemo(() => {
    if (filteredHistory.length === 0) return { minTime: 0, maxTime: 1 };
    const t0 = new Date(filteredHistory[0].effective_date.replace(' ', 'T')).getTime();
    const t1 = new Date(filteredHistory[filteredHistory.length - 1].effective_date.replace(' ', 'T')).getTime();
    const span = Math.max(86400000, t1 - t0);
    return { minTime: t0 - span * 0.04, maxTime: t1 + span * 0.04 };
  }, [filteredHistory]);

  const getX = useCallback((dateStr: string) => {
    const t = new Date(dateStr.replace(' ', 'T')).getTime();
    const ratio = Math.max(0, Math.min(1, (t - minTime) / (maxTime - minTime || 1)));
    return padLeft + ratio * innerW;
  }, [minTime, maxTime, innerW]);

  // Y-Scale calculations
  const { minYVal, maxYVal, yTicks } = useMemo(() => {
    if (metric === 'pace') {
      // Invert pace so faster (lower sec/km) is at the top
      let minP = 250; // fastest (e.g. 4:10/km)
      let maxP = 440; // slowest (e.g. 7:20/km)

      const paces = [
        ...lt1Points.map(p => p.lt1_pace_sec_km!),
        ...lt2Points.map(p => p.lt2_pace_sec_km!),
        ...(currentThresholds?.lt2PaceSecKm ? [currentThresholds.lt2PaceSecKm] : []),
        ...(currentThresholds?.lt1PaceSecKm ? [currentThresholds.lt1PaceSecKm] : [])
      ];

      if (paces.length > 0) {
        const obsMin = Math.min(...paces);
        const obsMax = Math.max(...paces);
        minP = Math.floor((obsMin - 15) / 15) * 15;
        maxP = Math.ceil((obsMax + 15) / 15) * 15;
      }

      const ticks = [];
      const step = Math.max(20, Math.round((maxP - minP) / 4 / 5) * 5);
      for (let p = minP; p <= maxP; p += step) {
        ticks.push(p);
      }
      return { minYVal: minP, maxYVal: maxP, yTicks: ticks };
    } else {
      // Heart rate: standard higher = top
      let minH = 130;
      let maxH = 195;

      const hrs = [
        ...lt1Points.map(p => p.lt1_hr!),
        ...lt2Points.map(p => p.lt2_hr!),
        ...(currentThresholds?.lt2Hr ? [currentThresholds.lt2Hr] : []),
        ...(currentThresholds?.lt1Hr ? [currentThresholds.lt1Hr] : [])
      ];

      if (hrs.length > 0) {
        const obsMin = Math.min(...hrs);
        const obsMax = Math.max(...hrs);
        minH = Math.floor((obsMin - 5) / 5) * 5;
        maxH = Math.ceil((obsMax + 5) / 5) * 5;
      }

      const ticks = [];
      const step = Math.max(10, Math.round((maxH - minH) / 4 / 5) * 5);
      for (let h = minH; h <= maxH; h += step) {
        ticks.push(h);
      }
      return { minYVal: minH, maxYVal: maxH, yTicks: ticks };
    }
  }, [metric, lt1Points, lt2Points, currentThresholds]);

  const getY = useCallback((val: number) => {
    if (metric === 'pace') {
      // Faster pace (lower value) is higher up (towards padTop)
      const ratio = (val - minYVal) / (maxYVal - minYVal || 1);
      return padTop + ratio * innerH;
    } else {
      // Higher HR is higher up
      const ratio = (val - minYVal) / (maxYVal - minYVal || 1);
      return padTop + (1 - ratio) * innerH;
    }
  }, [metric, minYVal, maxYVal, innerH]);

  // Build SVG Paths
  const buildPath = useCallback((pts: CalibrationHistoryItem[], valGetter: (p: CalibrationHistoryItem) => number) => {
    if (pts.length === 0) return '';
    const coords = pts.map(p => ({ x: getX(p.effective_date), y: getY(valGetter(p)) }));
    return coords.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`, '');
  }, [getX, getY]);

  const lt1Path = useMemo(() => {
    return buildPath(lt1Points, p => (metric === 'pace' ? p.lt1_pace_sec_km! : p.lt1_hr!));
  }, [buildPath, lt1Points, metric]);

  const lt2Path = useMemo(() => {
    return buildPath(lt2Points, p => (metric === 'pace' ? p.lt2_pace_sec_km! : p.lt2_hr!));
  }, [buildPath, lt2Points, metric]);

  // Baseline Reference Line Y values
  const activeLt2Y = useMemo(() => {
    if (!currentThresholds) return null;
    const val = metric === 'pace' ? currentThresholds.lt2PaceSecKm : currentThresholds.lt2Hr;
    return val ? getY(val) : null;
  }, [currentThresholds, metric, getY]);

  const activeLt1Y = useMemo(() => {
    if (!currentThresholds) return null;
    const val = metric === 'pace' ? currentThresholds.lt1PaceSecKm : currentThresholds.lt1Hr;
    return val ? getY(val) : null;
  }, [currentThresholds, metric, getY]);

  const hasData = lt1Points.length > 0 || lt2Points.length > 0;

  return (
    <section className="threshold-trends-card" style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 12,
      padding: '1.25rem',
      marginBottom: '1.5rem',
      position: 'relative'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <TrendingUp size={18} color="#06b6d4" />
            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.progress.thresholdTrendsTitle}
            </span>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            {showIndividualRuns ? t.progress.thresholdTrendsDesc : t.thresholdTrends.rollingDesc}
          </p>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <button className="filter-pill-btn" aria-pressed={showIndividualRuns}
            onClick={() => { setShowIndividualRuns(v => !v); setHoveredPoint(null); }}>
            {showIndividualRuns ? t.thresholdTrends.showRolling : t.thresholdTrends.showIndividual}
          </button>
          {/* Metric Toggle: Pace vs HR */}
          <div className="filter-pills" style={{ display: 'flex', background: 'var(--bg-card-subtle, rgba(255,255,255,0.05))', borderRadius: 8, padding: 2 }}>
            <button
              className={`filter-pill-btn ${metric === 'pace' ? 'active' : ''}`}
              onClick={() => setMetric('pace')}
              style={{ fontSize: '0.74rem', padding: '0.25rem 0.65rem', borderRadius: 6 }}
            >
              <Clock size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              {t.progress.paceTrend}
            </button>
            <button
              className={`filter-pill-btn ${metric === 'hr' ? 'active' : ''}`}
              onClick={() => setMetric('hr')}
              style={{ fontSize: '0.74rem', padding: '0.25rem 0.65rem', borderRadius: 6 }}
            >
              <Heart size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              {t.progress.hrTrend}
            </button>
          </div>

          {/* Time Range Filter */}
          <div className="filter-pills" style={{ display: 'flex', background: 'var(--bg-card-subtle, rgba(255,255,255,0.05))', borderRadius: 8, padding: 2 }}>
            <button
              className={`filter-pill-btn ${timeRange === '3m' ? 'active' : ''}`}
              onClick={() => setTimeRange('3m')}
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', borderRadius: 6 }}
            >
              {t.progress.range3m || '3M'}
            </button>
            <button
              className={`filter-pill-btn ${timeRange === '6m' ? 'active' : ''}`}
              onClick={() => setTimeRange('6m')}
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', borderRadius: 6 }}
            >
              {t.progress.range6m || '6M'}
            </button>
            <button
              className={`filter-pill-btn ${timeRange === '12m' ? 'active' : ''}`}
              onClick={() => setTimeRange('12m')}
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', borderRadius: 6 }}
            >
              12M
            </button>
            <button
              className={`filter-pill-btn ${timeRange === 'all' ? 'active' : ''}`}
              onClick={() => setTimeRange('all')}
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', borderRadius: 6 }}
            >
              {t.progress.rangeAll || 'All'}
            </button>
          </div>
        </div>
      </div>

      {/* Active Baseline Badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '0.75rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }}></span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.progress.lt2ThresholdBadge}:</span>
          <span style={{ color: '#f59e0b', fontWeight: 700 }}>
            {currentThresholds?.lt2PaceSecKm ? formatPace(currentThresholds.lt2PaceSecKm) : '--'}
            {currentThresholds?.lt2Hr ? ` (~${currentThresholds.lt2Hr} bpm)` : ''}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }}></span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.progress.lt1AerobicBaseBadge}:</span>
          <span style={{ color: '#10b981', fontWeight: 700 }}>
            {currentThresholds?.lt1PaceSecKm ? formatPace(currentThresholds.lt1PaceSecKm) : '--'}
            {currentThresholds?.lt1Hr ? ` (~${currentThresholds.lt1Hr} bpm)` : ''}
          </span>
        </div>

        <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {t.progress.hoverHint}
        </span>
      </div>

      {/* SVG Chart Area */}
      {!hasData ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {t.progress.noTrendData}
        </div>
      ) : (
        <div className="svg-chart-wrapper" style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: '100%', minWidth: 650, height: 'auto', maxHeight: 300, display: 'block' }}
          >
            {/* Gridlines & Y-Axis Labels */}
            {yTicks.map(val => {
              const y = getY(val);
              const labelStr = metric === 'pace' ? formatPace(val) : `${val} bpm`;
              return (
                <g key={val}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke="rgba(255, 255, 255, 0.08)"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    fill="var(--text-muted)"
                    fontSize="10"
                    textAnchor="end"
                    fontWeight="500"
                  >
                    {labelStr}
                  </text>
                </g>
              );
            })}

            {/* Active Rolling Baseline Reference Lines */}
            {activeLt2Y !== null && (
              <g>
                <line
                  x1={padLeft}
                  y1={activeLt2Y}
                  x2={width - padRight}
                  y2={activeLt2Y}
                  stroke="#f59e0b"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                  strokeOpacity="0.7"
                />
                <text
                  x={width - padRight + 4}
                  y={activeLt2Y + 3}
                  fill="#f59e0b"
                  fontSize="9"
                  fontWeight="600"
                >
                  LT2
                </text>
              </g>
            )}

            {activeLt1Y !== null && (
              <g>
                <line
                  x1={padLeft}
                  y1={activeLt1Y}
                  x2={width - padRight}
                  y2={activeLt1Y}
                  stroke="#10b981"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                  strokeOpacity="0.7"
                />
                <text
                  x={width - padRight + 4}
                  y={activeLt1Y + 3}
                  fill="#10b981"
                  fontSize="9"
                  fontWeight="600"
                >
                  LT1
                </text>
              </g>
            )}

            {/* LT1 Trend Path */}
            {lt1Path && (
              <path
                d={lt1Path}
                fill="none"
                stroke="#10b981"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* LT2 Trend Path */}
            {lt2Path && (
              <path
                d={lt2Path}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* LT1 Interactive Points */}
            {lt1Points.map(p => {
              const x = getX(p.effective_date);
              const val = metric === 'pace' ? p.lt1_pace_sec_km! : p.lt1_hr!;
              const y = getY(val);
              const isHovered = hoveredPoint?.item.effective_date === p.effective_date && hoveredPoint?.type === 'lt1';

              return (
                <g
                  key={`lt1-${p.effective_date}`}
                  onMouseEnter={() => setHoveredPoint({ type: 'lt1', item: p, x, y })}
                  onMouseLeave={() => setHoveredPoint(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    aria-label={`LT1 ${p.effective_date}: ${val}`}
                    cx={x}
                    cy={y}
                    r={isHovered ? 6 : 4}
                    fill={isHovered ? '#34d399' : '#10b981'}
                    stroke="var(--bg-card)"
                    strokeWidth="2"
                  />
                  {/* Invisible touch target */}
                  <circle cx={x} cy={y} r={14} fill="transparent" />
                </g>
              );
            })}

            {/* LT2 Interactive Points */}
            {lt2Points.map(p => {
              const x = getX(p.effective_date);
              const val = metric === 'pace' ? p.lt2_pace_sec_km! : p.lt2_hr!;
              const y = getY(val);
              const isHovered = hoveredPoint?.item.effective_date === p.effective_date && hoveredPoint?.type === 'lt2';

              return (
                <g
                  key={`lt2-${p.effective_date}`}
                  onMouseEnter={() => setHoveredPoint({ type: 'lt2', item: p, x, y })}
                  onMouseLeave={() => setHoveredPoint(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    aria-label={`LT2 ${p.effective_date}: ${val}`}
                    cx={x}
                    cy={y}
                    r={isHovered ? 6 : 4}
                    fill={isHovered ? '#fbbf24' : '#f59e0b'}
                    stroke="var(--bg-card)"
                    strokeWidth="2"
                  />
                  {/* Invisible touch target */}
                  <circle cx={x} cy={y} r={14} fill="transparent" />
                </g>
              );
            })}

            {/* X-Axis Dates */}
            {filteredHistory.map((p, idx) => {
              // Only draw label for every Nth point or if span is wide
              const step = Math.max(1, Math.floor(filteredHistory.length / 6));
              if (idx % step !== 0 && idx !== filteredHistory.length - 1) return null;
              const x = getX(p.effective_date);

              return (
                <text
                  key={`date-${idx}`}
                  x={x}
                  y={height - padBottom + 18}
                  fill="var(--text-muted)"
                  fontSize="9.5"
                  textAnchor="middle"
                >
                  {formatDate(p.effective_date)}
                </text>
              );
            })}
          </svg>

          {/* Floating Glassmorphic Tooltip */}
          {hoveredPoint && (
            <div
              style={{
                position: 'absolute',
                top: Math.max(10, Math.min(height - 100, hoveredPoint.y + 10)),
                left: Math.max(15, Math.min(width - 240, hoveredPoint.x - 110)),
                background: 'rgba(15, 23, 42, 0.95)',
                border: `1px solid ${hoveredPoint.type === 'lt1' ? '#10b981' : '#f59e0b'}`,
                borderRadius: 8,
                padding: '0.65rem 0.85rem',
                color: '#fff',
                fontSize: '0.75rem',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                pointerEvents: 'none',
                zIndex: 20,
                minWidth: 190
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ fontWeight: 700, color: hoveredPoint.type === 'lt1' ? '#34d399' : '#fbbf24' }}>
                  {hoveredPoint.type === 'lt1' ? t.progress.lt1AerobicBaseBadge : t.progress.lt2ThresholdBadge}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                  {formatDate(hoveredPoint.item.effective_date)}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', margin: '0.2rem 0' }}>
                <span style={{ color: '#cbd5e1' }}>{t.common.pace}:</span>
                <span style={{ fontWeight: 700, color: '#fff' }}>
                  {hoveredPoint.type === 'lt1'
                    ? (hoveredPoint.item.lt1_pace_sec_km ? formatPace(hoveredPoint.item.lt1_pace_sec_km) : '--')
                    : (hoveredPoint.item.lt2_pace_sec_km ? formatPace(hoveredPoint.item.lt2_pace_sec_km) : '--')}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', margin: '0.2rem 0' }}>
                <span style={{ color: '#cbd5e1' }}>{t.common.heartRate}:</span>
                <span style={{ fontWeight: 700, color: '#fff' }}>
                  {hoveredPoint.type === 'lt1'
                    ? `${hoveredPoint.item.lt1_hr || '--'} bpm`
                    : `${hoveredPoint.item.lt2_hr || '--'} bpm`}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', margin: '0.2rem 0' }}>
                <span style={{ color: '#cbd5e1' }}>{t.common.confidence}:</span>
                <span style={{ fontWeight: 600, color: '#38bdf8' }}>
                  {(hoveredPoint.item.confidence * 100).toFixed(0)}%
                </span>
              </div>

              {hoveredPoint.item.activity_name && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.35rem', paddingTop: '0.35rem', color: '#94a3b8', fontSize: '0.7rem' }}>
                  {translateActivityName(hoveredPoint.item.activity_name, language)}
                </div>
              )}

              {hoveredPoint.item.notes && (
                <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.68rem', marginTop: '0.2rem' }}>
                  "{translateCalibrationNote(hoveredPoint.item.notes, language)}"
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
