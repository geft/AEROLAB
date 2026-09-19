import React, { useState, useEffect } from 'react';
import { Activity, Flame, ShieldAlert, CheckCircle2, TrendingUp, HelpCircle, X } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';

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
  const { t, language } = useTranslation();
  const [data, setData] = useState<TrainingStatusData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [hoveredDay, setHoveredDay] = useState<DayLoadPoint | null>(null);
  const [showGuide, setShowGuide] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/activities/training-load?days=30')
      .then(res => res.json())
      .then(json => {
        if (json.trainingStatus) {
          setData(json.trainingStatus);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ padding: '1.25rem', minHeight: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {language === 'zh' ? '正在计算训练负荷...' : 'Calculating training load...'}
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

  const statusColor = getStatusColor(data.status);

  // SVG Chart Metrics
  const timeline = data.timeline || [];
  const chartHeight = 110;
  const chartWidth = 540;
  const paddingLeft = 36;
  const paddingRight = 16;
  const paddingTop = 12;
  const paddingBottom = 22;
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

  return (
    <div className="card" style={{ padding: '1.25rem', position: 'relative', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Activity size={18} color="var(--accent-cyan)" />
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {language === 'zh' ? '7天训练负荷与最适区间' : '7-Day Training Load & Optimal Tunnel'}
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
            {language === 'zh'
              ? '基于心率储备与EPOC模型，对比7天急性负荷与28天基础体能'
              : 'EPOC & cardiac impulse model: 7-day acute fatigue vs. 28-day fitness baseline'}
          </p>
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
          <span>{data.statusLabel}</span>
          <span style={{ opacity: 0.7, fontSize: '0.72rem', fontWeight: 500 }}>
            (ACWR: {data.acwr})
          </span>
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
            {language === 'zh' ? '7天急性负荷' : '7-Day Acute Load'}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: statusColor, marginTop: '0.15rem' }}>
            {data.currentAcuteLoad}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
            {language === 'zh' ? '当前疲劳指数' : 'Current fatigue index'}
          </div>
        </div>

        {/* Optimal Range */}
        <div style={{ background: 'var(--bg-surface)', padding: '0.65rem 0.85rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            {language === 'zh' ? '最适负荷区间' : 'Optimal Tunnel'}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#10b981', marginTop: '0.15rem' }}>
            {data.optimalRange.min} - {data.optimalRange.max}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
            {language === 'zh' ? '最佳效益区间' : 'Optimal sweet spot'}
          </div>
        </div>

        {/* Chronic Load */}
        <div style={{ background: 'var(--bg-surface)', padding: '0.65rem 0.85rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            {language === 'zh' ? '28天体能基线' : '28-Day Chronic Baseline'}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem' }}>
            {data.currentChronicLoad}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
            {language === 'zh' ? '长期有氧耐受力' : 'Aerobic work capacity'}
          </div>
        </div>

        {/* 7-Day Total */}
        <div style={{ background: 'var(--bg-surface)', padding: '0.65rem 0.85rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            {language === 'zh' ? '近7天累计负荷' : 'Past 7 Days Raw Load'}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-cyan)', marginTop: '0.15rem' }}>
            {data.last7DaysLoad}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
            {language === 'zh' ? '本周跑步总刺激' : 'Cumulative effort units'}
          </div>
        </div>
      </div>

      {/* 30-Day Interactive Optimal Tunnel Graph */}
      <div style={{ width: '100%', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          style={{ width: '100%', minWidth: 460, height: 'auto', maxHeight: 130, display: 'block' }}
        >
          <defs>
            <linearGradient id="tunnelGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.08" />
            </linearGradient>
          </defs>

          {/* Gridlines */}
          {[0, 0.5, 1].map((ratio, i) => {
            const y = paddingTop + innerHeight * (1 - ratio);
            const val = Math.round(maxVal * ratio);
            return (
              <g key={i}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke="rgba(255, 255, 255, 0.06)"
                  strokeDasharray="3 3"
                />
                <text
                  x={paddingLeft - 6}
                  y={y + 3}
                  fill="var(--text-muted)"
                  fontSize="8"
                  textAnchor="end"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Optimal Tunnel Shaded Region */}
          {tunnelPath && (
            <path d={tunnelPath} fill="url(#tunnelGrad)" stroke="rgba(16, 185, 129, 0.3)" strokeWidth="0.8" />
          )}

          {/* Acute Load Line */}
          {acutePath && (
            <path d={acutePath} fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {/* Data Points and Hover triggers */}
          {timeline.map((pt, idx) => {
            const x = getX(idx);
            const y = getY(pt.acuteLoad);
            const isLatest = idx === timeline.length - 1;
            return (
              <g
                key={pt.date}
                onMouseEnter={() => setHoveredDay(pt)}
                onMouseLeave={() => setHoveredDay(null)}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={isLatest ? 3.5 : 2}
                  fill={isLatest ? '#38bdf8' : '#06b6d4'}
                  stroke="var(--bg-card)"
                  strokeWidth="1.5"
                />
                <rect
                  x={x - 6}
                  y={paddingTop}
                  width={12}
                  height={innerHeight}
                  fill="transparent"
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Hover Information Badge */}
      <div style={{
        marginTop: '0.4rem',
        fontSize: '0.74rem',
        color: 'var(--text-secondary)',
        minHeight: '1.2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        {hoveredDay ? (
          <span>
            <strong>{hoveredDay.date}</strong> — {language === 'zh' ? '当日跑步' : 'Daily'}: {hoveredDay.dailyLoad} | {language === 'zh' ? '7天负荷' : 'Acute'}: {hoveredDay.acuteLoad} | {language === 'zh' ? '最适区间' : 'Tunnel'}: {hoveredDay.optimalMin}-{hoveredDay.optimalMax}
          </span>
        ) : (
          <span>
            {data.statusDescription}
          </span>
        )}
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {language === 'zh' ? '绿色阴影 = 最适区间 (Optimal Tunnel)' : 'Green shaded band = Optimal Tunnel'}
        </span>
      </div>

      {/* Explanation Guide Modal */}
      {showGuide && (
        <div style={{
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
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
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
                {language === 'zh' ? '训练负荷与最适区间说明' : 'Training Load & Optimal Tunnel Guide'}
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
                {language === 'zh'
                  ? '本功能根据每场跑步的心率储备强度与时长（Firstbeat EPOC / Bannister TRIMP模型），实时计算您的7天急性负荷与28天体能基线：'
                  : 'Calculates physiological workout strain based on Heart Rate Reserve (%HRR) and duration, modeling 7-day acute fatigue against 28-day chronic baseline:'}
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                <li><strong>Optimal (0.8 - 1.3 ACWR)</strong>: {language === 'zh' ? '最佳训练区间（绿色阴影隧道），有氧体能稳步提升且伤病风险最低。' : 'The optimal sweet spot where aerobic fitness increases with low injury risk.'}</li>
                <li><strong>Maintaining (0.8 - 1.05)</strong>: {language === 'zh' ? '负荷适中，保持当前体能水平。' : 'Workload is steady and maintains aerobic capacity.'}</li>
                <li><strong>Recovery (&lt; 0.8)</strong>: {language === 'zh' ? '负荷低于基线，适合减量周或赛前调整。' : 'Workload has dropped below baseline; suitable for taper weeks.'}</li>
                <li><strong>Overreaching (&gt; 1.3)</strong>: {language === 'zh' ? '负荷激增过快，需注意疲劳恢复。' : 'Workload is ramping up quickly; watch fatigue levels.'}</li>
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
                {language === 'zh' ? '知道了' : 'Got it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
