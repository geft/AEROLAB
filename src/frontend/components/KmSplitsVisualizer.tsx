import React, { useState, useMemo } from 'react';
import { Gauge, Heart, Zap, Mountain, TrendingUp, TrendingDown, Award, Clock, ArrowRight, Activity, Minus } from 'lucide-react';
import { formatPace, formatDuration, formatEfficiency } from '../utils/formatters.js';

export interface SplitItem {
  id?: number;
  split_index: number;
  distance_meters: number;
  duration_seconds: number;
  avg_pace_sec_km: number | null;
  avg_heart_rate: number | null;
  split_efficiency_factor: number | null;
  elevation_change_m: number | null;
}

interface KmSplitsVisualizerProps {
  splits: SplitItem[];
  overallAvgPace?: number | null;
  overallAvgHr?: number | null;
  lt1Hr?: number;
  lt2Hr?: number;
  compact?: boolean;
}

export type SplitMetric = 'pace' | 'hr' | 'ef' | 'elevation';

export const KmSplitsVisualizer: React.FC<KmSplitsVisualizerProps> = ({
  splits,
  overallAvgPace,
  overallAvgHr,
  lt1Hr = 148,
  lt2Hr = 167,
  compact = false
}) => {
  const [selectedMetric, setSelectedMetric] = useState<SplitMetric>('pace');

  // Filter out invalid splits
  const validSplits = useMemo(() => {
    if (!splits || !Array.isArray(splits)) return [];
    return splits.filter(s => s && (s.distance_meters > 50 || s.duration_seconds > 10));
  }, [splits]);

  // Statistical calculations
  const stats = useMemo(() => {
    if (validSplits.length === 0) return null;

    const paces = validSplits.map(s => s.avg_pace_sec_km).filter((p): p is number => p !== null && p > 0);
    const hrs = validSplits.map(s => s.avg_heart_rate).filter((h): h is number => h !== null && h > 0);
    const efs = validSplits.map(s => s.split_efficiency_factor).filter((e): e is number => e !== null && e > 0);
    const elevs = validSplits.map(s => s.elevation_change_m || 0);

    const minPace = paces.length > 0 ? Math.min(...paces) : 0;
    const maxPace = paces.length > 0 ? Math.max(...paces) : 0;
    const avgPace = paces.length > 0 ? paces.reduce((a, b) => a + b, 0) / paces.length : (overallAvgPace || 0);

    const minHr = hrs.length > 0 ? Math.min(...hrs) : 0;
    const maxHr = hrs.length > 0 ? Math.max(...hrs) : 0;
    const avgHr = hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : (overallAvgHr || 0);

    const minEf = efs.length > 0 ? Math.min(...efs) : 0;
    const maxEf = efs.length > 0 ? Math.max(...efs) : 0;

    const maxElevChange = elevs.length > 0 ? Math.max(...elevs.map(Math.abs), 5) : 10;

    // Identify fastest split index
    const fastestSplit = paces.length > 0 ? validSplits.find(s => s.avg_pace_sec_km === minPace) : null;
    const slowestSplit = paces.length > 0 ? validSplits.find(s => s.avg_pace_sec_km === maxPace) : null;
    const paceSpreadSec = maxPace - minPace;

    // Pacing Strategy (Negative vs Positive Split)
    let pacingStrategy: { type: 'negative' | 'positive' | 'even'; label: string; diffSec: number; desc: string } | null = null;
    if (paces.length >= 3) {
      const mid = Math.floor(paces.length / 2);
      const firstHalfPaces = paces.slice(0, mid);
      const secondHalfPaces = paces.slice(mid);
      const firstAvg = firstHalfPaces.reduce((a, b) => a + b, 0) / firstHalfPaces.length;
      const secondAvg = secondHalfPaces.reduce((a, b) => a + b, 0) / secondHalfPaces.length;
      const diff = Math.round(secondAvg - firstAvg); // Negative means second half is faster

      if (diff <= -3) {
        pacingStrategy = {
          type: 'negative',
          label: `Negative Split (${Math.abs(diff)}s/km faster in 2nd half)`,
          diffSec: diff,
          desc: 'Progressive acceleration — exemplary pacing discipline without early burn-out.'
        };
      } else if (diff >= 4) {
        pacingStrategy = {
          type: 'positive',
          label: `Positive Split (${diff}s/km slower in 2nd half)`,
          diffSec: diff,
          desc: 'Early surge fatigue — pace drifted slower as glycogen and cardiac cost accumulated.'
        };
      } else {
        pacingStrategy = {
          type: 'even',
          label: `Even Pacing (±${Math.abs(diff)}s/km across halves)`,
          diffSec: diff,
          desc: 'Metronomic consistency — steady metabolic conservation throughout the session.'
        };
      }
    }

    // Consistency Standard Deviation
    const paceStdDev = paces.length > 1
      ? Math.round(Math.sqrt(paces.map(p => Math.pow(p - avgPace, 2)).reduce((a, b) => a + b, 0) / paces.length))
      : 0;

    return {
      minPace,
      maxPace,
      avgPace,
      minHr,
      maxHr,
      avgHr,
      minEf,
      maxEf,
      maxElevChange,
      fastestSplit,
      slowestSplit,
      paceSpreadSec,
      pacingStrategy,
      paceStdDev
    };
  }, [validSplits, overallAvgPace, overallAvgHr]);

  if (validSplits.length === 0 || !stats) {
    return (
      <div className="splits-empty-state">
        <Clock size={28} color="var(--text-muted)" />
        <p>No kilometer split data available for this activity.</p>
      </div>
    );
  }

  return (
    <div className={`km-splits-container ${compact ? 'compact' : ''}`}>
      {/* Visualizer Controls Header */}
      <div className="splits-controls-header">
        <div className="splits-title-area">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} color="var(--accent-cyan)" />
            <span className="splits-section-title">Kilometer Split Paces &amp; Dynamics</span>
          </div>
          <span className="splits-count-badge">{validSplits.length} splits</span>
        </div>

        {/* Metric Selector Pills */}
        <div className="splits-metric-pills">
          <button
            className={`metric-pill-btn ${selectedMetric === 'pace' ? 'active' : ''}`}
            onClick={() => setSelectedMetric('pace')}
            title="Visualize Pace Variation (min/km)"
          >
            <Gauge size={13} />
            <span>Pace</span>
          </button>
          <button
            className={`metric-pill-btn ${selectedMetric === 'hr' ? 'active' : ''}`}
            onClick={() => setSelectedMetric('hr')}
            title="Visualize Heart Rate Variation (bpm)"
          >
            <Heart size={13} />
            <span>Heart Rate</span>
          </button>
          <button
            className={`metric-pill-btn ${selectedMetric === 'ef' ? 'active' : ''}`}
            onClick={() => setSelectedMetric('ef')}
            title="Visualize Efficiency Factor Variation"
          >
            <Zap size={13} />
            <span>Efficiency</span>
          </button>
          <button
            className={`metric-pill-btn ${selectedMetric === 'elevation' ? 'active' : ''}`}
            onClick={() => setSelectedMetric('elevation')}
            title="Visualize Elevation Profile per KM"
          >
            <Mountain size={13} />
            <span>Elevation</span>
          </button>
        </div>
      </div>

      {/* Pacing Insights Banner (Shown in full mode) */}
      {!compact && (
        <div className="splits-insights-banner">
          <div className="split-insight-card">
            <span className="split-insight-label">Fastest Split</span>
            <div className="split-insight-val cyan">
              {stats.fastestSplit?.avg_pace_sec_km ? formatPace(stats.fastestSplit.avg_pace_sec_km) : '—'}
            </div>
            <span className="split-insight-sub">
              {stats.fastestSplit ? `KM ${stats.fastestSplit.split_index}` : '—'}
            </span>
          </div>

          <div className="split-insight-card">
            <span className="split-insight-label">Slowest Split</span>
            <div className="split-insight-val amber">
              {stats.slowestSplit?.avg_pace_sec_km ? formatPace(stats.slowestSplit.avg_pace_sec_km) : '—'}
            </div>
            <span className="split-insight-sub">
              {stats.slowestSplit ? `KM ${stats.slowestSplit.split_index}` : '—'}
            </span>
          </div>

          <div className="split-insight-card">
            <span className="split-insight-label">Pace Spread (Δ)</span>
            <div className="split-insight-val" style={{ color: stats.paceSpreadSec <= 15 ? 'var(--accent-green)' : 'var(--text-primary)' }}>
              ±{stats.paceSpreadSec}s
            </div>
            <span className="split-insight-sub">
              Std Dev: ±{stats.paceStdDev}s/km
            </span>
          </div>

          {stats.pacingStrategy && (
            <div className={`split-insight-card strategy ${stats.pacingStrategy.type}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {stats.pacingStrategy.type === 'negative' && <TrendingDown size={15} color="#10b981" />}
                {stats.pacingStrategy.type === 'positive' && <TrendingUp size={15} color="#f59e0b" />}
                {stats.pacingStrategy.type === 'even' && <Minus size={15} color="#06b6d4" />}
                <span className="strategy-title">{stats.pacingStrategy.label}</span>
              </div>
              <p className="strategy-desc">{stats.pacingStrategy.desc}</p>
            </div>
          )}
        </div>
      )}

      {/* Split Bars List */}
      <div className="splits-bar-list">
        {validSplits.map((split) => {
          const pace = split.avg_pace_sec_km;
          const hr = split.avg_heart_rate;
          const ef = split.split_efficiency_factor;
          const elev = split.elevation_change_m ?? 0;
          const isPartial = split.distance_meters > 0 && split.distance_meters < 900;
          const isFastest = stats.fastestSplit && split.split_index === stats.fastestSplit.split_index;

          // Bar width calculations per metric
          let barWidthPct = 50;
          let barColor = 'var(--accent-cyan)';
          let metricDisplayVal = '';
          let deltaFromAvg: { val: string; isBetter: boolean; isNeutral: boolean } | null = null;

          if (selectedMetric === 'pace') {
            if (pace && stats.minPace && stats.maxPace) {
              // Faster pace = longer bar
              barWidthPct = stats.minPace === stats.maxPace
                ? 80
                : 35 + ((stats.maxPace - pace) / (stats.maxPace - stats.minPace)) * 65;

              const diff = Math.round(pace - stats.avgPace);
              deltaFromAvg = {
                val: diff === 0 ? '±0s' : diff < 0 ? `${diff}s` : `+${diff}s`,
                isBetter: diff < 0,
                isNeutral: Math.abs(diff) <= 2
              };

              if (isFastest) {
                barColor = 'linear-gradient(90deg, rgba(6, 182, 212, 0.4), #06b6d4)';
              } else if (diff < -2) {
                barColor = 'linear-gradient(90deg, rgba(16, 185, 129, 0.4), #10b981)';
              } else if (diff > 4) {
                barColor = 'linear-gradient(90deg, rgba(245, 158, 11, 0.4), #f59e0b)';
              } else {
                barColor = 'linear-gradient(90deg, rgba(56, 189, 248, 0.3), #38bdf8)';
              }
            }
            metricDisplayVal = formatPace(pace);
          } else if (selectedMetric === 'hr') {
            if (hr && stats.minHr && stats.maxHr) {
              barWidthPct = stats.minHr === stats.maxHr
                ? 75
                : 40 + ((hr - stats.minHr) / (stats.maxHr - stats.minHr)) * 60;

              const diff = Math.round(hr - stats.avgHr);
              deltaFromAvg = {
                val: diff === 0 ? '0 bpm' : diff > 0 ? `+${diff} bpm` : `${diff} bpm`,
                isBetter: diff <= 0,
                isNeutral: Math.abs(diff) <= 1
              };

              if (hr <= lt1Hr) {
                barColor = 'linear-gradient(90deg, rgba(16, 185, 129, 0.4), #10b981)'; // Z1/Z2
              } else if (hr < lt2Hr) {
                barColor = 'linear-gradient(90deg, rgba(6, 182, 212, 0.4), #06b6d4)'; // Z3
              } else {
                barColor = 'linear-gradient(90deg, rgba(245, 158, 11, 0.4), #f59e0b)'; // Z4/Z5
              }
            }
            metricDisplayVal = hr ? `${Math.round(hr)} bpm` : '—';
          } else if (selectedMetric === 'ef') {
            if (ef && stats.minEf && stats.maxEf) {
              barWidthPct = stats.minEf === stats.maxEf
                ? 70
                : 35 + ((ef - stats.minEf) / (stats.maxEf - stats.minEf)) * 65;
              barColor = 'linear-gradient(90deg, rgba(6, 182, 212, 0.4), #06b6d4)';
            }
            metricDisplayVal = formatEfficiency(ef) ? `${formatEfficiency(ef)} EF` : '—';
          } else if (selectedMetric === 'elevation') {
            const absElev = Math.abs(elev);
            barWidthPct = Math.min(100, 20 + (absElev / stats.maxElevChange) * 80);
            if (elev > 0.5) {
              barColor = 'linear-gradient(90deg, rgba(245, 158, 11, 0.4), #f59e0b)';
            } else if (elev < -0.5) {
              barColor = 'linear-gradient(90deg, rgba(16, 185, 129, 0.4), #10b981)';
            } else {
              barColor = 'linear-gradient(90deg, rgba(148, 163, 184, 0.3), #94a3b8)';
            }
            metricDisplayVal = elev > 0 ? `+${elev.toFixed(1)}m` : `${elev.toFixed(1)}m`;
          }

          return (
            <div key={split.split_index} className={`split-bar-row ${isFastest ? 'is-fastest' : ''}`}>
              {/* Split Header / Number */}
              <div className="split-num-col">
                <span className="split-badge">
                  KM {split.split_index}
                  {isPartial && <span className="partial-tag">({Math.round(split.distance_meters)}m)</span>}
                </span>
                {isFastest && selectedMetric === 'pace' && (
                  <span className="fastest-indicator" title="Fastest Kilometer Split">
                    <Award size={12} />
                  </span>
                )}
              </div>

              {/* Primary Metric Number */}
              <div className="split-primary-val">
                {metricDisplayVal}
              </div>

              {/* Bar Visual Track */}
              <div className="split-bar-track-area">
                <div className="split-bar-bg-track">
                  <div
                    className="split-bar-fill"
                    style={{
                      width: `${Math.max(8, Math.min(100, barWidthPct))}%`,
                      background: barColor
                    }}
                  />
                </div>

                {/* Delta Badge */}
                {deltaFromAvg && (
                  <span className={`split-delta-pill ${deltaFromAvg.isNeutral ? 'neutral' : deltaFromAvg.isBetter ? 'better' : 'slower'}`}>
                    {deltaFromAvg.val}
                  </span>
                )}
              </div>

              {/* Secondary Telemetry Chips */}
              <div className="split-secondary-stats">
                {selectedMetric !== 'pace' && (
                  <span className="sec-chip pace" title="Pace">
                    <Gauge size={11} /> {formatPace(pace)}
                  </span>
                )}
                {selectedMetric !== 'hr' && hr && (
                  <span className="sec-chip hr" title="Heart Rate">
                    <Heart size={11} color={hr >= lt2Hr ? '#f59e0b' : hr > lt1Hr ? '#06b6d4' : '#10b981'} />
                    {Math.round(hr)}
                  </span>
                )}
                {selectedMetric !== 'ef' && ef && (
                  <span className="sec-chip ef" title="Efficiency Factor">
                    <Zap size={11} /> {formatEfficiency(ef)}
                  </span>
                )}
                {selectedMetric !== 'elevation' && elev !== 0 && (
                  <span className="sec-chip elev" title="Elevation Delta">
                    <Mountain size={11} /> {elev > 0 ? `+${Math.round(elev)}m` : `${Math.round(elev)}m`}
                  </span>
                )}
                <span className="sec-chip time" title="Split Duration">
                  <Clock size={11} /> {formatDuration(split.duration_seconds)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
