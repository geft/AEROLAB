import React, { useMemo } from 'react';
import { formatPace } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';

export interface SplitItem {
  id?: number;
  split_index: number;
  distance_meters: number;
  duration_seconds: number;
  avg_pace_sec_km: number | null;
  avg_heart_rate: number | null;
  split_efficiency_factor: number | null;
  elevation_change_m: number | null;
  avg_cadence?: number | null;
  avg_stance_time?: number | null;  // GCT in ms
  avg_vert_osc?: number | null;     // Vertical Oscillation in mm
  avg_vert_ratio?: number | null;   // Vertical Ratio %
}

interface KmSplitsVisualizerProps {
  splits: SplitItem[];
  overallAvgPace?: number | null;
  compact?: boolean;
}

export const KmSplitsVisualizer: React.FC<KmSplitsVisualizerProps> = ({
  splits,
  overallAvgPace,
  compact = false
}) => {
  const { t } = useTranslation();

  // Filter out invalid splits
  const validSplits = useMemo(() => {
    if (!splits || !Array.isArray(splits)) return [];
    return splits.filter(s => s && (s.distance_meters > 50 || s.duration_seconds > 10));
  }, [splits]);

  // Statistical calculations
  const stats = useMemo(() => {
    if (validSplits.length === 0) return null;

    const paces = validSplits.map(s => s.avg_pace_sec_km).filter((p): p is number => p !== null && p > 0);
    const minPace = paces.length > 0 ? Math.min(...paces) : 0;
    const maxPace = paces.length > 0 ? Math.max(...paces) : 0;
    const avgPace = paces.length > 0 ? paces.reduce((a, b) => a + b, 0) / paces.length : (overallAvgPace || 0);

    // Identify fastest split index
    const fastestSplit = paces.length > 0 ? validSplits.find(s => s.avg_pace_sec_km === minPace) : null;
    const slowestSplit = paces.length > 0 ? validSplits.find(s => s.avg_pace_sec_km === maxPace) : null;
    const paceSpreadSec = maxPace - minPace;

    // Consistency Standard Deviation
    const paceStdDev = paces.length > 1
      ? Math.round(Math.sqrt(paces.map(p => Math.pow(p - avgPace, 2)).reduce((a, b) => a + b, 0) / paces.length))
      : 0;

    return {
      minPace,
      maxPace,
      avgPace,
      fastestSplit,
      slowestSplit,
      paceSpreadSec,
      paceStdDev
    };
  }, [validSplits, overallAvgPace]);

  if (validSplits.length === 0 || !stats) {
    return (
      <div className="splits-empty-state">
        <p>{t.splits.noSplits}</p>
      </div>
    );
  }

  return (
    <div className={`km-splits-container ${compact ? 'compact' : ''}`}>
      {/* Split Header */}
      <div className="splits-controls-header">
        <div className="splits-title-area">
          <span className="splits-section-title">{t.splits.title}</span>
          <span className="splits-count-badge">{validSplits.length} {t.splits.split}</span>
        </div>
      </div>

      {/* Pacing Insights Banner (Shown in full mode) */}
      {!compact && (
        <div className="splits-insights-banner">
          <div className="split-insight-card">
            <span className="split-insight-label">{t.splits.fastestSplit}</span>
            <div className="split-insight-val cyan">
              {stats.fastestSplit?.avg_pace_sec_km ? formatPace(stats.fastestSplit.avg_pace_sec_km) : '—'}
            </div>
            <span className="split-insight-sub">
              {stats.fastestSplit ? `KM ${stats.fastestSplit.split_index}` : '—'}
            </span>
          </div>

          <div className="split-insight-card">
            <span className="split-insight-label">{t.splits.slowestSplit}</span>
            <div className="split-insight-val amber">
              {stats.slowestSplit?.avg_pace_sec_km ? formatPace(stats.slowestSplit.avg_pace_sec_km) : '—'}
            </div>
            <span className="split-insight-sub">
              {stats.slowestSplit ? `KM ${stats.slowestSplit.split_index}` : '—'}
            </span>
          </div>

          <div className="split-insight-card">
            <span className="split-insight-label">{t.splits.paceSpread}</span>
            <div className="split-insight-val" style={{ color: stats.paceSpreadSec <= 15 ? 'var(--accent-emerald)' : 'var(--text-primary)' }}>
              ±{stats.paceSpreadSec}s
            </div>
            <span className="split-insight-sub">
              {t.splits.stdDev}: ±{stats.paceStdDev}s/km
            </span>
          </div>
        </div>
      )}

      {/* Split Bars List */}
      <div className="splits-bar-list">
        {validSplits.map((split) => {
          const pace = split.avg_pace_sec_km;
          const isPartial = split.distance_meters > 0 && split.distance_meters < 900;
          const isFastest = Boolean(stats.fastestSplit && split.split_index === stats.fastestSplit.split_index);
          const diff = pace != null && pace > 0 ? Math.round(pace - stats.avgPace) : null;
          const barWidthPct = pace != null && stats.minPace !== stats.maxPace
            ? 35 + ((stats.maxPace - pace) / (stats.maxPace - stats.minPace)) * 65
            : 80;
          const barColor = diff != null && diff < -2
            ? 'linear-gradient(90deg, rgba(16, 185, 129, 0.4), #10b981)'
              : diff != null && diff > 4
                ? 'linear-gradient(90deg, rgba(245, 158, 11, 0.4), #f59e0b)'
                : 'linear-gradient(90deg, rgba(6, 182, 212, 0.4), #06b6d4)';
          const strideLength = pace != null && pace > 0 && split.avg_cadence != null && split.avg_cadence > 0
            ? 120_000 / (pace * split.avg_cadence)
            : null;
          const verticalOscillationCm = split.avg_vert_osc != null
            ? (split.avg_vert_osc < 25 ? split.avg_vert_osc : split.avg_vert_osc / 10)
            : null;

          return (
            <div key={split.split_index} className={`split-bar-row ${isFastest ? 'is-fastest' : ''}`}>
              {/* Split Header / Number */}
              <div className="split-num-col">
                <span className="split-badge">
                  KM {split.split_index}
                  {isPartial && <span className="partial-tag">({Math.round(split.distance_meters)}m)</span>}
                </span>
              </div>

              <div className="split-primary-val" title={t.splits.pace}>
                {formatPace(pace)}
              </div>

              <div className="split-bar-track-area" aria-hidden="true">
                <div className="split-bar-bg-track">
                  {pace != null && pace > 0 && (
                    <div
                      className="split-bar-fill"
                      style={{
                        width: `${Math.max(8, Math.min(100, barWidthPct))}%`,
                        background: barColor
                      }}
                    />
                  )}
                </div>
              </div>
              <span className="split-heart-rate">
                {split.avg_heart_rate != null && split.avg_heart_rate > 0 ? `${Math.round(split.avg_heart_rate)} bpm` : '—'}
              </span>
              <div className="split-telemetry">
                {split.avg_cadence != null && split.avg_cadence > 0 && (
                  <span><b>{t.browse.cadenceShort}</b> {Math.round(split.avg_cadence)} spm</span>
                )}
                {split.avg_stance_time != null && split.avg_stance_time > 0 && (
                  <span><b>{t.browse.gctShort}</b> {Math.round(split.avg_stance_time)} ms</span>
                )}
                {verticalOscillationCm != null && verticalOscillationCm > 0 && (
                  <span><b>{t.browse.verticalOscLabelShort}</b> {verticalOscillationCm.toFixed(1)} cm</span>
                )}
                {strideLength != null && (
                  <span><b>{t.browse.strideLengthShort}</b> {strideLength.toFixed(2)} m</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
