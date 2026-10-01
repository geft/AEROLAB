import React, { useState, useEffect, useRef } from 'react';
import { Activity, Flame, ShieldAlert, CheckCircle2, TrendingUp, HelpCircle, X } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { getTrainingLoad } from '../api/client.js';

export interface DayLoadPoint {
  date: string;
  dailyLoad: number;
  acuteLoad: number;
  chronicLoad: number;
  optimalMin: number;
  optimalMax: number;
  acwr: number;
}

export interface TrainingStatusData {
  currentAcuteLoad: number;
  currentChronicLoad: number;
  acwr: number;
  status: 'optimal' | 'recovery' | 'overreaching' | 'very_high' | 'maintaining' | 'establishing';
  statusLabel: string;
  statusDescription: string;
  optimalRange: {
    min: number;
    max: number;
  };
  last7DaysLoad: number;
  timeline: DayLoadPoint[];
}

export const TrainingLoadCard: React.FC = () => {
  const { t } = useTranslation();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<TrainingStatusData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [hoveredDay, setHoveredDay] = useState<DayLoadPoint | null>(null);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const [showGuide, setShowGuide] = useState<boolean>(false);

  useEffect(() => {
    setLoading(true);
    getTrainingLoad(days)
      .then(json => {
        if (json.trainingStatus) {
          setData(json.trainingStatus);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [days]);

  if (loading && !data) {
    return (
      <div className="card" style={{ padding: '1.25rem', minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {t.trainingLoad.loading}
        </div>
      </div>
    );
  }

  if (!data || !Array.isArray(data.timeline)) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'optimal':
        return '#10b981'; // Emerald
      case 'maintaining':
        return '#06b6d4'; // Cyan
      case 'recovery':
        return '#38bdf8'; // Sky
      case 'overreaching':
        return '#f59e0b'; // Amber
      case 'very_high':
        return '#f43f5e'; // Rose
      default:
        return '#94a3b8';
    }
  };

  const getLocalizedStatusLabel = (status: string, fallback: string) =>
    t.trainingLoad.statusLabels[status] || fallback;

  const getLocalizedStatusDesc = (status: string, fallback: string) =>
    t.trainingLoad.statusDescriptions[status] || fallback;

  const statusColor = getStatusColor(data.status);

  // SVG Chart Metrics (responsive & generous breathing room)
  const timeline = data.timeline || [];
  const activeDayIndex = selectedDayIndex ?? -1;
  const chartHeight = 185;
  const chartWidth = 800;
  const paddingLeft = 44;
  const paddingRight = 24;
  const paddingTop = 16;
  const paddingBottom = 28;
  const innerWidth = chartWidth - paddingLeft - paddingRight;
  const innerHeight = chartHeight - paddingTop - paddingBottom;

  const maxVal = Math.max(
    ...timeline.map(p => Math.max(p.acuteLoad || 0, p.optimalMax || 0)),
    data.currentAcuteLoad * 1.2,
    100
  );

  const getX = (idx: number) => {
    if (timeline.length <= 1) return paddingLeft + innerWidth / 2;
    return paddingLeft + (idx / (timeline.length - 1)) * innerWidth;
  };

  const getY = (val: number) => {
    const safeVal = Number.isFinite(val) ? Math.max(0, val) : 0;
    const ratio = maxVal > 0 ? safeVal / maxVal : 0;
    return paddingTop + innerHeight - ratio * innerHeight;
  };

  // Build shaded polygon path for the Optimal Tunnel
  const tunnelPointsTop = timeline.map((p, i) => `${getX(i)},${getY(p.optimalMax)}`).join(' ');
  const tunnelPointsBottom = [...timeline].reverse().map((p, i) => `${getX(timeline.length - 1 - i)},${getY(p.optimalMin)}`).join(' ');
  const tunnelPath = timeline.length > 1 ? `M ${tunnelPointsTop} L ${tunnelPointsBottom} Z` : '';

  // Build Acute Load line
  const acutePoints = timeline.map((p, i) => `${getX(i)},${getY(p.acuteLoad)}`).join(' L ');
  const acutePath = timeline.length > 1 ? `M ${acutePoints}` : '';

  // X-axis date tick helper
  const formatDateTick = (dateStr: string) => {
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
      }
      return dateStr.slice(5);
    } catch {
      return dateStr.slice(5);
    }
  };

  const tickInterval = Math.max(1, Math.floor((timeline.length - 1) / 6));
  const isTickVisible = (idx: number) => {
    if (idx === 0 || idx === timeline.length - 1) return true;
    return idx % tickInterval === 0 && (timeline.length - 1 - idx) > (tickInterval * 0.4);
  };

  return (
    <div className="card" style={{ padding: '1.25rem', position: 'relative' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Activity size={18} color="var(--accent-cyan)" />
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.trainingLoad.title}
            </h3>
            <button
              type="button"
              onClick={() => setShowGuide(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: 0
              }}
              title="Training Load Guide"
            >
              <HelpCircle size={14} />
            </button>
          </div>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {t.trainingLoad.subtitle}
          </p>
        </div>

        {/* Right Section: Time Filter & Current Status Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Time Filter Pills */}
          <div style={{ display: 'inline-flex', background: 'var(--bg-surface)', padding: '2px', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
            {[7, 14, 30, 60, 90].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                style={{
                  background: days === d ? 'var(--accent-cyan)' : 'transparent',
                  color: days === d ? '#ffffff' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '0.25rem 0.55rem',
                  fontSize: '0.75rem',
                  fontWeight: days === d ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {d}D
              </button>
            ))}
          </div>

          {/* Current Status Pill */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.35rem 0.8rem',
            borderRadius: 999,
            background: `${statusColor}18`,
            border: `1px solid ${statusColor}44`,
            color: statusColor,
            fontWeight: 700,
            fontSize: '0.82rem'
          }}>
            {data.status === 'optimal' && <CheckCircle2 size={14} />}
            {data.status === 'overreaching' && <Flame size={14} />}
            {data.status === 'very_high' && <ShieldAlert size={14} />}
            {data.status === 'maintaining' && <TrendingUp size={14} />}
            <span>{getLocalizedStatusLabel(data.status, data.statusLabel)}</span>
            <span style={{ opacity: 0.7, fontSize: '0.72rem', fontWeight: 500 }}>
              (ACWR: {data.acwr})
            </span>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: '0.75rem',
        marginBottom: '1rem'
      }}>
        {/* Acute Load */}
        <div style={{ background: 'var(--bg-surface)', padding: '0.65rem 0.85rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            {t.trainingLoad.acuteTitle}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: statusColor, marginTop: '0.15rem' }}>
            {data.currentAcuteLoad}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
            {t.trainingLoad.acuteDesc}
          </div>
        </div>

        {/* Optimal Range */}
        <div style={{ background: 'var(--bg-surface)', padding: '0.65rem 0.85rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            {t.trainingLoad.optimalTitle}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#10b981', marginTop: '0.15rem' }}>
            {data.optimalRange.min} - {data.optimalRange.max}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
            {t.trainingLoad.optimalDesc}
          </div>
        </div>

        {/* Chronic Load */}
        <div style={{ background: 'var(--bg-surface)', padding: '0.65rem 0.85rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            {t.trainingLoad.chronicTitle}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
            {data.currentChronicLoad}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
            {t.trainingLoad.chronicDesc}
          </div>
        </div>

        {/* 7-Day Total */}
        <div style={{ background: 'var(--bg-surface)', padding: '0.65rem 0.85rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            {t.trainingLoad.weeklyTitle}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-cyan)', marginTop: '0.15rem' }}>
            {data.last7DaysLoad}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
            {t.trainingLoad.weeklyDesc}
          </div>
        </div>
      </div>

      {/* Interactive Optimal Tunnel Graph (100% responsive fluid SVG) */}
      <div className="training-load-chart-scroll" ref={chartScrollRef}>
        <svg
          className="training-load-chart"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          style={{ width: '100%', height: 'auto', maxHeight: 230, display: 'block' }}
          onPointerMove={event => {
            if (timeline.length < 2) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * chartWidth;
            const index = Math.max(0, Math.min(timeline.length - 1,
              Math.round(((x - paddingLeft) / innerWidth) * (timeline.length - 1))));
            setSelectedDayIndex(index);
            setHoveredDay(timeline[index] ?? null);
          }}
          onPointerLeave={() => {
            setSelectedDayIndex(null);
            setHoveredDay(null);
          }}
        >
          <defs>
            <linearGradient id="tunnelGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.30" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.08" />
            </linearGradient>
          </defs>

          {/* Horizontal Gridlines & Y-Axis values */}
          {[0, 0.33, 0.66, 1].map((ratio, i) => {
            const y = paddingTop + innerHeight * (1 - ratio);
            const val = Math.round(maxVal * ratio);
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
                  className="training-load-axis-label"
                  x={paddingLeft - 8}
                  y={y + 3.5}
                  fill="var(--text-muted)"
                  fontSize="9.5"
                  fontWeight="600"
                  textAnchor="end"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Optimal Tunnel Shaded Region */}
          {tunnelPath && (
            <path d={tunnelPath} fill="url(#tunnelGrad)" stroke="rgba(16, 185, 129, 0.45)" strokeWidth="1.2" />
          )}

          {/* Acute Load Line */}
          {acutePath && (
            <path d={acutePath} fill="none" stroke="#06b6d4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {/* X-Axis Date Ticks */}
          {timeline.map((pt, idx) => {
            if (!isTickVisible(idx)) return null;
            const x = getX(idx);
            return (
              <text
                className="training-load-axis-label"
                key={`tick-${pt.date}`}
                x={x}
                y={chartHeight - 6}
                fill="var(--text-muted)"
                fontSize="9.5"
                fontWeight="500"
                textAnchor={idx === 0 ? 'start' : idx === timeline.length - 1 ? 'end' : 'middle'}
              >
                {formatDateTick(pt.date)}
              </text>
            );
          })}

          {/* Data Points and Hover triggers */}
          {timeline.map((pt, idx) => {
            const x = getX(idx);
            const y = getY(pt.acuteLoad);
            const isLatest = idx === timeline.length - 1;
            return (
              <g
                key={pt.date}
                aria-hidden="true"
              >
                {idx === activeDayIndex && (
                  <line
                    x1={x}
                    y1={paddingTop}
                    x2={x}
                    y2={chartHeight - paddingBottom}
                    stroke="var(--text-secondary)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={idx === activeDayIndex ? 7 : isLatest ? 5.5 : 3.5}
                  fill={idx === activeDayIndex ? 'var(--chart-series-amber)' : isLatest ? '#38bdf8' : '#06b6d4'}
                  stroke="var(--bg-card)"
                  strokeWidth="2"
                />
                <rect
                  x={x - 8}
                  y={paddingTop}
                  width={16}
                  height={innerHeight}
                  fill="transparent"
                />
              </g>
            );
          })}
        </svg>
      </div>

      {timeline.length > 1 && (
        <label className="chart-point-selector">
          <span>{t.progress.chartPointSelector}</span>
          <input
            type="range"
            min={0}
            max={timeline.length - 1}
            value={selectedDayIndex ?? timeline.length - 1}
            aria-label={t.progress.chartPointSelector}
            onChange={event => {
              const index = Number(event.currentTarget.value);
              setSelectedDayIndex(index);
              setHoveredDay(timeline[index] ?? null);
              const scroller = chartScrollRef.current;
              if (scroller) {
                scroller.scrollTo({
                  left: (scroller.scrollWidth - scroller.clientWidth) * (index / (timeline.length - 1)),
                  behavior: 'smooth'
                });
              }
            }}
          />
        </label>
      )}

      {/* Hover Information Badge */}
      <div style={{
        marginTop: '0.6rem',
        fontSize: '0.76rem',
        color: 'var(--text-secondary)',
        minHeight: '1.3rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.5rem'
      }}>
        {hoveredDay ? (
          <span>
            <strong>{hoveredDay.date}</strong> — {t.trainingLoad.hoverDaily}: {hoveredDay.dailyLoad} | {t.trainingLoad.hoverAcute}: {hoveredDay.acuteLoad} | {t.trainingLoad.hoverTunnel}: {hoveredDay.optimalMin}-{hoveredDay.optimalMax}
          </span>
        ) : (
          <span>
            {getLocalizedStatusDesc(data.status, data.statusDescription)}
          </span>
        )}
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {t.trainingLoad.legend}
        </span>
      </div>

      {/* Explanation Guide Modal */}
      {showGuide && (
        <div className="training-load-guide-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div className="training-load-guide-modal" style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: '1.5rem',
            maxWidth: 520,
            width: '100%',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.trainingLoad.guideTitle}
              </h4>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p style={{ margin: 0 }}>
                {t.trainingLoad.guideIntro}
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                <li><strong>Optimal (0.8 - 1.3 ACWR)</strong>: {t.trainingLoad.guideOptimal}</li>
                <li><strong>Maintaining (0.8 - 1.05)</strong>: {t.trainingLoad.guideMaintaining}</li>
                <li><strong>Recovery (&lt; 0.8)</strong>: {t.trainingLoad.guideRecovery}</li>
                <li><strong>Overreaching (&gt; 1.3)</strong>: {t.trainingLoad.guideOverreaching}</li>
              </ul>
            </div>

            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                style={{
                  background: 'var(--accent-cyan)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '0.45rem 1rem',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                {t.trainingLoad.gotIt}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
