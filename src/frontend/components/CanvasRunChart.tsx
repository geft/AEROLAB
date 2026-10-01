import React, { useRef, useEffect, useState } from 'react';
import { useTranslation } from '../i18n/LanguageContext.js';

interface RecordPoint {
  elapsed_seconds: number;
  heart_rate: number | null;
  speed_mps: number | null;
  speedMps?: number | null;
  altitude_m: number | null;
  distance_m: number | null;
  cadence: number | null;
}

interface CanvasRunChartProps {
  records: RecordPoint[];
  theme?: 'dark' | 'light';
}

export const CanvasRunChart: React.FC<CanvasRunChartProps> = ({ records, theme = 'dark' }) => {
  const { t, format } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [hoverData, setHoverData] = useState<{
    index: number;
    timeSec: number;
    hr: number | null;
    paceStr: string;
    alt: number | null;
    distKm: string;
  } | null>(null);

  const displayRecords = records;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = canvas?.parentElement;
    if (!wrapper || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setLayoutTick(tick => tick + 1));
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => setLayoutTick(tick => tick + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-font-size'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || displayRecords.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const isLight = theme === 'light';
    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const fontScale = rootFontSize / 16;

    ctx.clearRect(0, 0, width, height);

    // Find min and max for HR and Pace
    let minHr = 300, maxHr = 0;
    let minPace = 999, maxPace = 0; // in sec/km
    let minAlt = 9999, maxAlt = -9999;

    for (const r of displayRecords) {
      if (r.heart_rate && r.heart_rate > 50) {
        if (r.heart_rate < minHr) minHr = r.heart_rate;
        if (r.heart_rate > maxHr) maxHr = r.heart_rate;
      }
      const spd = r.speed_mps ?? r.speedMps;
      if (spd && spd > 1.0) {
        const paceSec = 1000 / spd;
        if (paceSec >= 180 && paceSec <= 600) { // filter out extreme spikes
          if (paceSec < minPace) minPace = paceSec;
          if (paceSec > maxPace) maxPace = paceSec;
        }
      }
      if (r.altitude_m !== null) {
        if (r.altitude_m < minAlt) minAlt = r.altitude_m;
        if (r.altitude_m > maxAlt) maxAlt = r.altitude_m;
      }
    }

    if (minHr === 300) { minHr = 100; maxHr = 170; }
    if (minPace === 999) { minPace = 240; maxPace = 360; }
    if (minAlt === 9999) { minAlt = 0; maxAlt = 50; }

    const padding = { top: 20, right: 64, bottom: 30, left: 40 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Draw Grid Lines
    ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Pace labels on left axis – drawn inside left-side padding, left-aligned
      const paceSecVal = Math.round(minPace + ((maxPace - minPace) / 4) * i);
      const paceMin = Math.floor(paceSecVal / 60);
      const paceSec = String(paceSecVal % 60).padStart(2, '0');
      ctx.fillStyle = isLight ? '#0369a1' : '#06b6d4';
      ctx.font = `${10 * fontScale}px Inter, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(`${paceMin}:${paceSec}`, 2, y + 3);

      // HR labels on right axis – drawn inside right-side padding, right-aligned to edge
      const hrVal = Math.round(maxHr - ((maxHr - minHr) / 4) * i);
      ctx.fillStyle = isLight ? '#b45309' : '#f59e0b';
      ctx.font = `${10 * fontScale}px Inter, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(`${hrVal}`, width - 2, y + 3);
    }

    // Draw Altitude Background Fill (Subtle mountain silhouette)
    if (maxAlt > minAlt) {
      ctx.beginPath();
      ctx.fillStyle = isLight ? 'rgba(148, 163, 184, 0.18)' : 'rgba(148, 163, 184, 0.08)';
      let startedAlt = false;
      for (let i = 0; i < displayRecords.length; i++) {
        const r = displayRecords[i];
        if (r.altitude_m !== null) {
          const x = padding.left + (i / (displayRecords.length - 1)) * chartW;
          const y = height - padding.bottom - ((r.altitude_m - minAlt) / (maxAlt - minAlt)) * (chartH * 0.45);
          if (!startedAlt) {
            ctx.moveTo(x, height - padding.bottom);
            ctx.lineTo(x, y);
            startedAlt = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
      }
      ctx.lineTo(width - padding.right, height - padding.bottom);
      ctx.closePath();
      ctx.fill();
    }

    // Draw HR Line (Amber)
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isLight ? '#b45309' : '#f59e0b';
    let startedHr = false;
    for (let i = 0; i < displayRecords.length; i++) {
      const r = displayRecords[i];
      if (r.heart_rate && r.heart_rate > 50) {
        const x = padding.left + (i / (displayRecords.length - 1)) * chartW;
        const y = height - padding.bottom - ((r.heart_rate - minHr) / (maxHr - minHr || 1)) * chartH;
        if (!startedHr) {
          ctx.moveTo(x, y);
          startedHr = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    }
    ctx.stroke();

    // Draw Pace Line (Cyan / Blue)
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isLight ? '#0369a1' : '#06b6d4';
    let startedPace = false;
    for (let i = 0; i < displayRecords.length; i++) {
      const r = displayRecords[i];
      const spd = r.speed_mps ?? r.speedMps;
      if (spd && spd > 1.0) {
        const paceSec = Math.max(minPace, Math.min(maxPace, 1000 / spd));
        const x = padding.left + (i / (displayRecords.length - 1)) * chartW;
        // Inverted: minPace (fastest) at top, maxPace (slowest) at bottom
        const yNorm = 1 - (paceSec - minPace) / (maxPace - minPace || 1);
        const y = height - padding.bottom - yNorm * chartH;
        if (!startedPace) {
          ctx.moveTo(x, y);
          startedPace = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    }
    ctx.stroke();

    // Keep the selected sample visible on the chart so the range control has
    // an obvious point-to-line relationship, including its initial position.
    const selectedIndex = hoverData?.index;
    const selectedRecord = selectedIndex === undefined ? null : displayRecords[selectedIndex];
    if (selectedRecord && selectedIndex !== undefined) {
      const x = displayRecords.length > 1
        ? padding.left + (selectedIndex / (displayRecords.length - 1)) * chartW
        : padding.left + chartW / 2;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.55)' : 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 1;
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      const drawSelectedPoint = (y: number, color: string) => {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = isLight ? '#ffffff' : '#0f172a';
        ctx.stroke();
      };

      if (selectedRecord.heart_rate && selectedRecord.heart_rate > 50) {
        const y = height - padding.bottom - ((selectedRecord.heart_rate - minHr) / (maxHr - minHr || 1)) * chartH;
        drawSelectedPoint(y, isLight ? '#b45309' : '#f59e0b');
      }
      const selectedSpeed = selectedRecord.speed_mps ?? selectedRecord.speedMps;
      if (selectedSpeed && selectedSpeed > 1.0) {
        const paceSec = Math.max(minPace, Math.min(maxPace, 1000 / selectedSpeed));
        const yNorm = 1 - (paceSec - minPace) / (maxPace - minPace || 1);
        const y = height - padding.bottom - yNorm * chartH;
        drawSelectedPoint(y, isLight ? '#0369a1' : '#06b6d4');
      }
      ctx.restore();
    }

  }, [displayRecords, theme, layoutTick, hoverData?.index]);

  const getReadout = (index: number) => {
    const r = displayRecords[index];
    if (!r) return null;
    let paceStr = '—';
    const spd = r.speed_mps ?? r.speedMps;
    if (spd && spd > 1.0) {
      const sec = Math.round(1000 / spd);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      paceStr = `${m}:${String(s).padStart(2, '0')}/km`;
    }

    return {
      index,
      timeSec: r.elapsed_seconds,
      hr: r.heart_rate,
      paceStr,
      alt: r.altitude_m,
      distKm: ((r.distance_m ?? 0) / 1000).toFixed(2)
    };
  };

  const formatElapsed = (timeSec: number) => `${Math.floor(timeSec / 60)}:${String(timeSec % 60).padStart(2, '0')}`;

  const handleChartPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (displayRecords.length < 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const plotLeft = 40;
    const plotRight = 64;
    const plotWidth = rect.width - plotLeft - plotRight;
    const x = event.clientX - rect.left - plotLeft;
    const index = Math.max(0, Math.min(displayRecords.length - 1,
      Math.round((x / plotWidth) * (displayRecords.length - 1))));
    setHoverData(getReadout(index));
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Legend & Hover readout bar */}
      <div className="telemetry-chart-meta">
        <div className="telemetry-chart-legend">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: theme === 'light' ? '#0369a1' : '#06b6d4', fontWeight: 600 }}>
            <span style={{ width: 10, height: 3, background: theme === 'light' ? '#0369a1' : '#06b6d4', borderRadius: 2 }}></span>
            <span>{t.common.pace}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: theme === 'light' ? '#b45309' : '#f59e0b', fontWeight: 600 }}>
            <span style={{ width: 10, height: 3, background: theme === 'light' ? '#b45309' : '#f59e0b', borderRadius: 2 }}></span>
            <span>{t.common.heartRate}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)' }}>
            <span style={{ width: 10, height: 8, background: 'rgba(148, 163, 184, 0.3)', borderRadius: 1 }}></span>
            <span>{t.browse.telemetryChartElevation}</span>
          </div>
        </div>

        <div className="telemetry-chart-readout-slot">
          {hoverData && (
            <div className="telemetry-chart-readout" role="status" aria-live="polite">
              <span>{format(t.browse.telemetrySamplePosition, { current: hoverData.index + 1, total: displayRecords.length })} · {formatElapsed(hoverData.timeSec)}</span>
              <span>{t.common.distance}: <b>{hoverData.distKm} {t.common.km}</b></span>
              <span>{t.common.pace}: <b>{hoverData.paceStr}</b></span>
              <span>{t.common.heartRate}: <b>{hoverData.hr ?? '—'} bpm</b></span>
              <span>{t.browse.telemetryChartAltitude}: <b>{hoverData.alt !== null ? `${hoverData.alt} m` : '—'}</b></span>
            </div>
          )}
        </div>
      </div>

      <div className="chart-canvas-wrapper">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
          onPointerMove={handleChartPointerMove}
          onPointerLeave={() => setHoverData(null)}
        />
      </div>
      {displayRecords.length > 1 && (
        <label className="telemetry-chart-sample-control">
          <span>{t.browse.telemetrySampleSelector}</span>
          <input
            type="range"
            min={0}
            max={displayRecords.length - 1}
            value={hoverData?.index ?? 0}
            aria-label={t.browse.telemetrySampleSelector}
            onFocus={() => setHoverData(getReadout(0))}
            onChange={event => setHoverData(getReadout(Number(event.currentTarget.value)))}
          />
        </label>
      )}
    </div>
  );
};
