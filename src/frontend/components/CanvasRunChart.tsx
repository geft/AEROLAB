import React, { useRef, useEffect, useState } from 'react';

interface RecordPoint {
  elapsed_seconds: number;
  heart_rate: number | null;
  speed_mps: number | null;
  altitude_m: number | null;
  distance_m: number | null;
  cadence: number | null;
}

interface CanvasRunChartProps {
  records: RecordPoint[];
  focusCoreSegment: boolean;
  theme?: 'dark' | 'light';
}

export const CanvasRunChart: React.FC<CanvasRunChartProps> = ({ records, focusCoreSegment, theme = 'dark' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverData, setHoverData] = useState<{
    index: number;
    timeSec: number;
    hr: number | null;
    paceStr: string;
    alt: number | null;
    distKm: string;
  } | null>(null);

  // Subsample and filter records if core segment is focused (trim first 5 mins / 300s and last 300s)
  const displayRecords = React.useMemo(() => {
    if (!records || records.length === 0) return [];
    if (!focusCoreSegment || records.length < 600) return records;

    const startTrimSec = 300; // 5 min warmup
    const endTrimSec = Math.max(startTrimSec + 60, records[records.length - 1].elapsed_seconds - 300);
    return records.filter(r => r.elapsed_seconds >= startTrimSec && r.elapsed_seconds <= endTrimSec);
  }, [records, focusCoreSegment]);

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
      if (r.speedMps && r.speedMps > 1.0) {
        const paceSec = 1000 / r.speedMps;
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

      // HR labels on right axis – drawn inside right-side padding, right-aligned to edge
      const hrVal = Math.round(maxHr - ((maxHr - minHr) / 4) * i);
      ctx.fillStyle = '#64748b';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${hrVal}`, width - 2, y + 3);
    }

    // 1. Draw Elevation (Background fill)
    if (maxAlt > minAlt) {
      ctx.beginPath();
      ctx.moveTo(padding.left, height - padding.bottom);
      for (let i = 0; i < displayRecords.length; i++) {
        const r = displayRecords[i];
        const x = padding.left + (i / (displayRecords.length - 1)) * chartW;
        const alt = r.altitude_m ?? minAlt;
        const yNorm = (alt - minAlt) / (maxAlt - minAlt || 1);
        const y = height - padding.bottom - yNorm * (chartH * 0.35); // max 35% height
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width - padding.right, height - padding.bottom);
      ctx.closePath();
      const altGradient = ctx.createLinearGradient(0, height - padding.bottom - chartH * 0.35, 0, height - padding.bottom);
      altGradient.addColorStop(0, isLight ? 'rgba(100, 116, 139, 0.22)' : 'rgba(148, 163, 184, 0.12)');
      altGradient.addColorStop(1, isLight ? 'rgba(100, 116, 139, 0.02)' : 'rgba(148, 163, 184, 0.01)');
      ctx.fillStyle = altGradient;
      ctx.fill();
    }

    // 2. Draw Heart Rate Line (Red/Orange)
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isLight ? '#d97706' : '#f59e0b';
    let startedHr = false;
    for (let i = 0; i < displayRecords.length; i++) {
      const r = displayRecords[i];
      if (r.heart_rate) {
        const x = padding.left + (i / (displayRecords.length - 1)) * chartW;
        const yNorm = (r.heart_rate - minHr) / (maxHr - minHr || 1);
        const y = height - padding.bottom - yNorm * chartH;
        if (!startedHr) {
          ctx.moveTo(x, y);
          startedHr = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
    }
    ctx.stroke();

    // 3. Draw Pace Line (Cyan/Sky, inverted y: faster pace = higher y)
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isLight ? '#0284c7' : '#06b6d4';
    let startedPace = false;
    for (let i = 0; i < displayRecords.length; i++) {
      const r = displayRecords[i];
      if (r.speedMps && r.speedMps > 1.0) {
        const paceSec = Math.max(minPace, Math.min(maxPace, 1000 / r.speedMps));
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

  }, [displayRecords, theme]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || displayRecords.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const padding = { left: 40, right: 40 };
    const chartW = rect.width - padding.left - padding.right;

    const relX = Math.max(0, Math.min(chartW, mouseX - padding.left));
    const idx = Math.min(displayRecords.length - 1, Math.round((relX / chartW) * (displayRecords.length - 1)));
    const r = displayRecords[idx];

    let paceStr = '—';
    if (r.speedMps && r.speedMps > 1.0) {
      const sec = Math.round(1000 / r.speedMps);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      paceStr = `${m}:${String(s).padStart(2, '0')}/km`;
    }

    setHoverData({
      index: idx,
      timeSec: r.elapsed_seconds,
      hr: r.heart_rate,
      paceStr,
      alt: r.altitude_m,
      distKm: ((r.distance_m ?? 0) / 1000).toFixed(2)
    });
  };

  const handleMouseLeave = () => {
    setHoverData(null);
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Legend & Hover readout bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.8rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
            <span style={{ width: 10, height: 3, background: 'var(--accent-cyan)', borderRadius: 2 }}></span>
            <span>Pace</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-amber)', fontWeight: 600 }}>
            <span style={{ width: 10, height: 3, background: 'var(--accent-amber)', borderRadius: 2 }}></span>
            <span>Heart Rate</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)' }}>
            <span style={{ width: 10, height: 8, background: 'rgba(148, 163, 184, 0.3)', borderRadius: 1 }}></span>
            <span>Elevation</span>
          </div>
        </div>

        {hoverData && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            background: 'var(--tag-pill-bg)',
            border: '1px solid var(--border-subtle)',
            padding: '0.2rem 0.65rem',
            borderRadius: 6,
            fontSize: '0.75rem'
          }}>
            <span>Dist: <b style={{ color: 'var(--text-primary)' }}>{hoverData.distKm} km</b></span>
            <span>Pace: <b style={{ color: 'var(--accent-cyan)' }}>{hoverData.paceStr}</b></span>
            <span>HR: <b style={{ color: 'var(--accent-amber)' }}>{hoverData.hr ?? '—'} bpm</b></span>
            <span>Alt: <b style={{ color: 'var(--text-muted)' }}>{hoverData.alt !== null ? `${hoverData.alt}m` : '—'}</b></span>
          </div>
        )}
      </div>

      <div className="chart-canvas-wrapper" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} />
      </div>
    </div>
  );
};
