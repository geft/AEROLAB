import React, { useState } from 'react';

interface IntervalsTableProps {
  intervals: any[];
  activityRunType?: string;
  formatPace: (secKm: number | null) => string;
  formatTime: (sec: number) => string;
}

export const IntervalsTable: React.FC<IntervalsTableProps> = ({
  intervals,
  activityRunType,
  formatPace,
  formatTime
}) => {
  const [intervalFilter, setIntervalFilter] = useState<'work_only' | 'all'>('work_only');

  const allIntervals = intervals || [];
  const workIntervals = allIntervals.filter((i: any) => i.type === 'work' || i.type === 'stride');
  const displayedIntervals = intervalFilter === 'work_only' && workIntervals.length > 0
    ? workIntervals
    : allIntervals;

  const isQualityRun = activityRunType === 'threshold_lt2' ||
    activityRunType === 'intervals_vo2' ||
    activityRunType === 'race';

  const snapToGrid = (v: number, grid: number[]): number => {
    let best = grid[0];
    let bestD = Math.abs(v - grid[0]);
    for (const g of grid) {
      const d = Math.abs(v - g);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  };

  const fmtPresc = (s: number): string => {
    const m = Math.floor(s / 60);
    const r = Math.round(s % 60);
    return r === 0 ? `${m}:00` : `${m}:${String(r).padStart(2, '0')}`;
  };

  const median = (vals: number[]): number | null => {
    if (vals.length === 0) return null;
    const s = [...vals].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const workOnlyForPresc = allIntervals.filter((i: any) => i.type === 'work');
  const firstWorkIdx = workOnlyForPresc.length > 0
    ? Math.min(...workOnlyForPresc.map((i: any) => i.interval_index))
    : 0;
  const lastWorkIdx = workOnlyForPresc.length > 0
    ? Math.max(...workOnlyForPresc.map((i: any) => i.interval_index))
    : 0;
  const recOnlyForPresc = allIntervals.filter((i: any) =>
    i.type === 'recovery' && i.interval_index > firstWorkIdx && i.interval_index < lastWorkIdx
  );

  const medWork = median(workOnlyForPresc.map((i: any) => i.duration_seconds).filter((d: number) => d > 0));
  const medRec = median(recOnlyForPresc.map((i: any) => i.duration_seconds).filter((d: number) => d > 0));
  const WORK_GRID = [60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1200, 1800];
  const REC_GRID = [30, 60, 90, 120, 180, 240, 300];

  const prescLabel = medWork !== null
    ? (medRec !== null
      ? `${workOnlyForPresc.length}×${fmtPresc(snapToGrid(medWork, WORK_GRID))} / ${fmtPresc(snapToGrid(medRec, REC_GRID))} rec`
      : `${workOnlyForPresc.length}×${fmtPresc(snapToGrid(medWork, WORK_GRID))}`)
    : null;

  const snappedWorkFor = (dur: number): number | null =>
    medWork !== null ? snapToGrid(dur, WORK_GRID) : null;

  return (
    <section className="data-table-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="sidebar-title">
            {intervalFilter === 'work_only'
              ? (isQualityRun ? `Interval Work Reps (${workIntervals.length})` : `Steady Segments & Strides (${workIntervals.length})`)
              : `All Segments & Recoveries (${allIntervals.length})`}
            {prescLabel && <span className="workreps-presc">{prescLabel}</span>}
          </span>
          <p style={{ fontSize: '0.76rem', color: '#94a3b8', margin: 0 }}>
            Durations show raw detection with snapped prescription hint (e.g. 14:03 → 15:00).
            HR Peak is the stimulus; Recovery Drop measures parasympathetic rebound.
          </p>
        </div>

        {allIntervals.length > 0 && (
          <div className="filter-pills" style={{ marginTop: 0 }}>
            <button
              className={`filter-pill-btn ${intervalFilter === 'work_only' ? 'active' : ''}`}
              onClick={() => setIntervalFilter('work_only')}
            >
              {isQualityRun ? `Work Reps Only (${workIntervals.length})` : `Steady & Strides Only (${workIntervals.length})`}
            </button>
            <button
              className={`filter-pill-btn ${intervalFilter === 'all' ? 'active' : ''}`}
              onClick={() => setIntervalFilter('all')}
            >
              All Segments ({allIntervals.length})
            </button>
          </div>
        )}
      </div>

      {displayedIntervals.length > 0 ? (
        <div className="table-wrapper">
          <table className="styled-table workreps-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Type</th>
                <th>Duration</th>
                <th>Distance</th>
                <th>
                  <div className="th-stacked">
                    <span>Pace</span>
                    <span className="th-sub">Avg · Peak</span>
                  </div>
                </th>
                <th title="Peak HR is cardiovascular stimulus; Avg HR reflects drift or lag.">
                  <div className="th-stacked">
                    <span>Heart Rate</span>
                    <span className="th-sub">Peak · Avg</span>
                  </div>
                </th>
                <th>
                  <div className="th-stacked">
                    <span>Dynamics</span>
                    <span className="th-sub">Cad · GCT · VO</span>
                  </div>
                </th>
                <th>
                  <div className="th-stacked">
                    <span>Rec Drop</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayedIntervals.map((inv: any) => {
                const isFirst = inv.interval_index === 1;
                const isLast = inv.interval_index === allIntervals.length;
                const isWarmup = isFirst && inv.duration_seconds > 180 && inv.type === 'recovery';
                const isCooldown = isLast && inv.duration_seconds > 180 && inv.type === 'recovery';

                const allIdx = allIntervals.findIndex((x: any) => x.id === inv.id);
                const nextSegment = allIdx >= 0 && allIdx + 1 < allIntervals.length ? allIntervals[allIdx + 1] : null;
                const nextRecoveryDrop = nextSegment && nextSegment.type === 'recovery' ? nextSegment.hr_drop : null;
                const effectiveDrop = inv.hr_drop || nextRecoveryDrop;

                const typeLabel = isWarmup ? 'Warmup' : (isCooldown ? 'Cooldown' : (inv.type === 'work' && !isQualityRun ? 'Steady' : inv.type));
                const badgeClass = inv.type === 'stride'
                  ? 'badge-intervals_vo2'
                  : (inv.type === 'work' ? (isQualityRun ? 'badge-threshold_lt2' : 'badge-easy_base') : 'badge-easy_base');

                return (
                  <tr key={inv.id}>
                    <td><b>{inv.interval_index}</b></td>
                    <td>
                      <span className={`run-badge ${badgeClass}`}>
                        {typeLabel}
                      </span>
                    </td>
                    <td>
                      {formatTime(inv.duration_seconds)}
                      {(inv.type === 'work' || inv.type === 'stride') && (() => {
                        const snapped = snappedWorkFor(inv.duration_seconds);
                        return snapped !== null && Math.abs(snapped - inv.duration_seconds) > 20 ? (
                          <span className="workreps-sub">→ {fmtPresc(snapped)}</span>
                        ) : null;
                      })()}
                    </td>
                    <td>
                      {inv.distance_meters >= 1000
                        ? `${(inv.distance_meters / 1000).toFixed(2)} km`
                        : `${Math.round(inv.distance_meters)}m`}
                    </td>
                    <td>
                      <div className="workreps-stacked-val">
                        <span className="val-primary" style={{ color: '#06b6d4', fontWeight: 600 }}>
                          {formatPace(inv.avg_pace_sec_km)}<span className="val-unit">/km</span>
                        </span>
                        {inv.peak_pace_sec_km && inv.peak_pace_sec_km < inv.avg_pace_sec_km && (
                          <span className="val-secondary">
                            {formatPace(inv.peak_pace_sec_km)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      {inv.type === 'stride' ? (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      ) : inv.type === 'work' ? (
                        <div className="workreps-stacked-val">
                          <span className="val-primary" style={{ fontWeight: 700, color: '#f59e0b' }}>
                            {inv.max_heart_rate} <span className="val-unit">bpm</span>
                          </span>
                          {inv.avg_heart_rate && inv.avg_heart_rate !== inv.max_heart_rate && (
                            <span className="val-secondary">
                              {inv.avg_heart_rate} avg
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontWeight: 500 }}>{inv.avg_heart_rate} <span className="val-unit">bpm</span></span>
                      )}
                    </td>
                    <td>
                      <span className="workreps-dyn">
                        <span className="workreps-dyn-line">
                          <span><b>{inv.avg_cadence ?? '—'}</b> <span className="workreps-dyn-label">spm</span></span>
                          <span>
                            <b>{inv.avg_stance_time != null ? Math.round(inv.avg_stance_time) : (inv.min_stance_time != null ? Math.round(inv.min_stance_time) : '—')}</b>
                            <span className="workreps-dyn-label"> ms</span>
                          </span>
                        </span>
                        <span className="workreps-dyn-line">
                          <span>
                            <b>{inv.avg_vert_osc != null ? Math.round(Number(inv.avg_vert_osc) < 25 ? Number(inv.avg_vert_osc) * 10 : Number(inv.avg_vert_osc)) : '—'}</b>
                            <span className="workreps-dyn-label"> mm</span>
                          </span>
                          <span>
                            <b>{inv.avg_stride_length != null ? Number(inv.avg_stride_length).toFixed(2) : (inv.avg_step_length != null ? Number(inv.avg_step_length * 2).toFixed(2) : '—')}</b>
                            <span className="workreps-dyn-label"> m</span>
                          </span>
                          {(() => {
                            const vo = inv.avg_vert_osc != null ? (Number(inv.avg_vert_osc) < 25 ? Number(inv.avg_vert_osc) * 10 : Number(inv.avg_vert_osc)) : null;
                            const step = inv.avg_step_length ?? (inv.avg_stride_length ? inv.avg_stride_length / 2 : null);
                            const vr = inv.avg_vert_ratio != null ? Number(inv.avg_vert_ratio) : (vo && step ? vo / (step * 10) : null);
                            if (vr == null || isNaN(vr) || !isFinite(vr)) return null;
                            return (
                              <span>
                                <b style={{ color: '#38bdf8' }}>{vr.toFixed(1)}%</b>
                                <span className="workreps-dyn-label"> VR</span>
                              </span>
                            );
                          })()}
                        </span>
                      </span>
                    </td>
                    <td>
                      {inv.type === 'stride' ? (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      ) : effectiveDrop ? (
                        <div className="workreps-stacked-val">
                          <span style={{ color: '#10b981', fontWeight: 600 }}>
                            -{effectiveDrop} <span className="val-unit">bpm</span>
                          </span>
                          {nextSegment && nextSegment.type === 'recovery' && inv.type === 'work' && (
                            <span className="val-secondary">
                              {formatTime(nextSegment.duration_seconds)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
          No interval reps found.
        </div>
      )}
    </section>
  );
};
