import React, { useState, useMemo, useCallback } from 'react';
import type { CalibrationHistoryItem as ContractCalibrationHistoryItem, ThresholdsResponse } from '../types/api.js';
import { Clock, Heart, TrendingUp } from 'lucide-react';
import { formatPace } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { translateActivityName, translateCalibrationNote } from '../i18n/coachTranslator.js';
import { rollingThreshold } from '../../shared/threshold-trend.js';

// Calibration point shape comes from the API contract so this component and
// ProgressView cannot drift apart.
export type CalibrationHistoryItem = ContractCalibrationHistoryItem;
interface ThresholdTrendsChartProps {
  history: CalibrationHistoryItem[];
  currentThresholds?: ThresholdsResponse['currentThresholds'];
}

export const ThresholdTrendsChart: React.FC<ThresholdTrendsChartProps> = ({
  history,
  currentThresholds
}) => {
  const { t, language, format, formatDate } = useTranslation();

  // Date.now() must not be called during render (react-hooks/purity), so capture a
  // stable "now" once per mount for the time-range fallback.
  const [mountedAt] = useState(() => Date.now());
  const [metric, setMetric] = useState<'pace' | 'hr'>('pace');
  const [timeRange, setTimeRange] = useState<'3m' | '6m' | '12m' | 'all'>('6m');
  const [showIndividualRuns, setShowIndividualRuns] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<{
    type: 'lt1' | 'lt2';
    item: CalibrationHistoryItem;
    x: number;
    y: number;
  } | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null);
  const cardRef = React.useRef<HTMLElement>(null);
  const activePoint = selectedPoint;

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
      .map(h => ({ hr: h[`${type}_hr`]!, pace: h[`${type}_pace_sec_km`] ?? 0,
        confidence: h.confidence ?? 0, effective_date: h.effective_date }));
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
  const selectablePoints = [
    ...lt1Points.map(item => ({ type: 'lt1' as const, item })),
    ...lt2Points.map(item => ({ type: 'lt2' as const, item }))
  ].sort((a, b) => a.item.effective_date.localeCompare(b.item.effective_date));
  const selectedPointIndex = selectedPoint
    ? selectablePoints.findIndex(point => point.type === selectedPoint.type && point.item.effective_date === selectedPoint.item.effective_date)
    : 0;
  const selectPointByIndex = (index: number) => {
    const point = selectablePoints[index];
    if (!point) return;
    const value = point.type === 'lt1'
      ? (metric === 'pace' ? point.item.lt1_pace_sec_km : point.item.lt1_hr)
      : (metric === 'pace' ? point.item.lt2_pace_sec_km : point.item.lt2_hr);
    if (value == null) return;
    setSelectedPoint({
      type: point.type,
      item: point.item,
      x: getX(point.item.effective_date),
      y: getY(value)
    });
  };

  return (
    <section ref={cardRef} className="threshold-trends-card" style={{
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
            onClick={() => { setShowIndividualRuns(v => !v); setSelectedPoint(null); }}>
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
          <div className="filter-pills threshold-trends-range" style={{ display: 'flex', background: 'var(--bg-card-subtle, rgba(255,255,255,0.05))', borderRadius: 8, padding: 2 }}>
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
              {format(t.common.monthsShort, { count: 12 })}
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
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--chart-series-amber)' }}></span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.progress.lt2ThresholdBadge}:</span>
          <span style={{ color: 'var(--chart-series-amber)', fontWeight: 700 }}>
            {currentThresholds?.lt2PaceSecKm ? formatPace(currentThresholds.lt2PaceSecKm) : '--'}
            {currentThresholds?.lt2Hr ? ` (~${currentThresholds.lt2Hr} bpm)` : ''}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--chart-series-green)' }}></span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.progress.lt1AerobicBaseBadge}:</span>
          <span style={{ color: 'var(--chart-series-green)', fontWeight: 700 }}>
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
        <>
        <div className="svg-chart-wrapper threshold-trends-scroll" role="region" aria-label={t.progress.hoverHint} tabIndex={0}>
          <svg
            className="threshold-trends-svg"
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: '100%', minWidth: 650, height: 'auto', maxHeight: 300, display: 'block' }}
            onPointerMove={event => {
              if (selectablePoints.length === 0) return;
              const cardRect = cardRef.current?.getBoundingClientRect();
              if (cardRect) {
                setTooltipPosition({
                  left: Math.max(8, Math.min(event.clientX - cardRect.left + 14, cardRect.width - 280)),
                  top: Math.max(8, Math.min(event.clientY - cardRect.top + 14, cardRect.height - 190))
                });
              }
              const rect = event.currentTarget.getBoundingClientRect();
              const x = ((event.clientX - rect.left) / rect.width) * width;
              const nearestIndex = selectablePoints.reduce((bestIndex, point, index) =>
                Math.abs(getX(point.item.effective_date) - x)
                  < Math.abs(getX(selectablePoints[bestIndex].item.effective_date) - x)
                  ? index
                  : bestIndex, 0);
              selectPointByIndex(nearestIndex);
            }}
            onPointerLeave={() => {
              setSelectedPoint(null);
              setTooltipPosition(null);
            }}
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
                    className="threshold-chart-axis-label"
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
                  stroke="var(--chart-series-amber)"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                  strokeOpacity="0.7"
                />
                <text
                  x={width - padRight + 4}
                  y={activeLt2Y + 3}
                  fill="var(--chart-series-amber)"
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
                  stroke="var(--chart-series-green)"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                  strokeOpacity="0.7"
                />
                <text
                  x={width - padRight + 4}
                  y={activeLt1Y + 3}
                  fill="var(--chart-series-green)"
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
                stroke="var(--chart-series-green)"
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
                stroke="var(--chart-series-amber)"
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
              const isHovered = selectedPoint?.item.effective_date === p.effective_date
                && selectedPoint?.type === 'lt1';

              return (
                <g
                  key={`lt1-${p.effective_date}`}
                  aria-label={format(t.thresholdTrends.chartPointAriaLabel, {
                    type: t.progress.lt1AerobicBaseBadge,
                    date: formatDate(p.effective_date),
                    value: metric === 'pace' ? `${formatPace(val)} ${t.common.pace}` : `${val} bpm`
                  })}
                >
                  <circle
                    aria-label={`LT1 ${p.effective_date}: ${val}`}
                    cx={x}
                    cy={y}
                    r={isHovered ? 6 : 4}
                    fill={isHovered ? 'var(--chart-series-green)' : 'var(--chart-series-green)'}
                    stroke="var(--bg-card)"
                    strokeWidth="2"
                  />
                  {/* Invisible touch target */}
                  <circle cx={x} cy={y} r={28} fill="transparent" aria-hidden="true" />
                </g>
              );
            })}

            {/* LT2 Interactive Points */}
            {lt2Points.map(p => {
              const x = getX(p.effective_date);
              const val = metric === 'pace' ? p.lt2_pace_sec_km! : p.lt2_hr!;
              const y = getY(val);
              const isHovered = selectedPoint?.item.effective_date === p.effective_date
                && selectedPoint?.type === 'lt2';

              return (
                <g
                  key={`lt2-${p.effective_date}`}
                  aria-label={format(t.thresholdTrends.chartPointAriaLabel, {
                    type: t.progress.lt2ThresholdBadge,
                    date: formatDate(p.effective_date),
                    value: metric === 'pace' ? `${formatPace(val)} ${t.common.pace}` : `${val} bpm`
                  })}
                >
                  <circle
                    aria-label={`LT2 ${p.effective_date}: ${val}`}
                    cx={x}
                    cy={y}
                    r={isHovered ? 6 : 4}
                    fill="var(--chart-series-amber)"
                    stroke="var(--bg-card)"
                    strokeWidth="2"
                  />
                  {/* Invisible touch target */}
                  <circle cx={x} cy={y} r={28} fill="transparent" aria-hidden="true" />
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
                  className="threshold-chart-axis-label"
                  fill="var(--text-muted)"
                  fontSize="9.5"
                  textAnchor="middle"
                >
                  {formatDate(p.effective_date)}
                </text>
              );
            })}
          </svg>

        </div>

        {activePoint && (
            <div
              className="threshold-trend-tooltip"
              role="status"
              aria-live="polite"
              style={{
                ...(tooltipPosition ? { left: tooltipPosition.left, top: tooltipPosition.top } : {}),
                border: `1px solid var(${activePoint.type === 'lt1' ? '--chart-series-green' : '--chart-series-amber'})`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span style={{ fontWeight: 700, color: `var(${activePoint.type === 'lt1' ? '--chart-series-green' : '--chart-series-amber'})` }}>
                  {activePoint.type === 'lt1' ? t.progress.lt1AerobicBaseBadge : t.progress.lt2ThresholdBadge}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {formatDate(activePoint.item.effective_date)}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', margin: '0.2rem 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t.common.pace}:</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  {activePoint.type === 'lt1'
                    ? (activePoint.item.lt1_pace_sec_km ? formatPace(activePoint.item.lt1_pace_sec_km) : '--')
                    : (activePoint.item.lt2_pace_sec_km ? formatPace(activePoint.item.lt2_pace_sec_km) : '--')}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', margin: '0.2rem 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t.common.heartRate}:</span>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  {activePoint.type === 'lt1'
                    ? `${activePoint.item.lt1_hr || '--'} bpm`
                    : `${activePoint.item.lt2_hr || '--'} bpm`}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', margin: '0.2rem 0' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{t.common.confidence}:</span>
                <span style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>
                  {((activePoint.item.confidence ?? 0) * 100).toFixed(0)}%
                </span>
              </div>

              {activePoint.item.activity_name && (
                <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '0.35rem', paddingTop: '0.35rem', color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                  {translateActivityName(activePoint.item.activity_name, language)}
                </div>
              )}

              {activePoint.item.notes && (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.68rem', marginTop: '0.2rem' }}>
                  {format(t.common.quotedText, { text: translateCalibrationNote(activePoint.item.notes, language) })}
                </div>
              )}
            </div>
          )}
        {selectablePoints.length > 1 && (
          <label className="chart-point-selector">
            <span>{t.progress.chartPointSelector}</span>
            <input
              type="range"
              min={0}
              max={selectablePoints.length - 1}
              value={Math.max(0, selectedPointIndex)}
              aria-label={t.progress.chartPointSelector}
              onChange={event => selectPointByIndex(Number(event.currentTarget.value))}
            />
          </label>
        )}
        </>
      )}
    </section>
  );
};
