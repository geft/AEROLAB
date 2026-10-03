import React, { useState } from 'react';
import type { ActivityInterval } from '../../types/api.js';
import { useTranslation } from '../../i18n/LanguageContext.js';
import {
  WORK_SNAP_SECONDS,
  formatPrescriptionClock,
  inferWorkoutPrescription,
  snapSeconds
} from '../../../shared/prescription.js';

interface IntervalsTableProps {
  intervals: ActivityInterval[];
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
  const { t, format } = useTranslation();
  const [intervalFilter, setIntervalFilter] = useState<'work_only' | 'all'>('work_only');

  const allIntervals = intervals || [];
  const workIntervals = allIntervals.filter((i: ActivityInterval) => i.type === 'work' || i.type === 'stride');
  const displayedIntervals = intervalFilter === 'work_only' && workIntervals.length > 0
    ? workIntervals
    : allIntervals;

  const isQualityRun = activityRunType === 'threshold_lt2' ||
    activityRunType === 'tempo' ||
    activityRunType === 'intervals_vo2' ||
    activityRunType === 'race';

  // The prescription hint comes from the shared helper the detector also uses, so
  // the hint shown here cannot disagree with the value the coach summary is built
  // from. This table used to round on its own grid instead.
  const hasWorkReps = allIntervals.some((i: ActivityInterval) => i.type === 'work');
  const prescLabel = inferWorkoutPrescription(
    allIntervals.map((i: ActivityInterval) => ({ type: i.type, durationSeconds: i.duration_seconds }))
  )?.label ?? null;

  const snappedWorkFor = (dur: number): number | null =>
    hasWorkReps ? snapSeconds(dur, WORK_SNAP_SECONDS) : null;

  return (
    <section className="data-table-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span className="sidebar-title">
            {intervalFilter === 'work_only'
              ? (isQualityRun ? format(t.browse.intervalWorkReps, { count: workIntervals.length }) : format(t.browse.steadySegments, { count: workIntervals.length }))
              : format(t.browse.segmentsRecoveries, { count: allIntervals.length })}
            {prescLabel && <span className="workreps-presc">{prescLabel}</span>}
          </span>
          <p style={{ fontSize: '0.76rem', color: '#94a3b8', margin: 0 }}>
            {t.browse.intervalExplanation}
          </p>
        </div>

        {allIntervals.length > 0 && (
          <div className="filter-pills" style={{ marginTop: 0 }}>
            <button
              className={`filter-pill-btn ${intervalFilter === 'work_only' ? 'active' : ''}`}
              onClick={() => setIntervalFilter('work_only')}
            >
              {isQualityRun ? format(t.browse.workOnlyCount, { count: workIntervals.length }) : format(t.browse.steadyOnlyCount, { count: workIntervals.length })}
            </button>
            <button
              className={`filter-pill-btn ${intervalFilter === 'all' ? 'active' : ''}`}
              onClick={() => setIntervalFilter('all')}
            >
              {format(t.browse.allSegmentsCount, { count: allIntervals.length })}
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
                <th>{t.common.type}</th>
                <th>{t.common.duration}</th>
                <th>{t.common.distance}</th>
                <th>
                  <div className="th-stacked">
                    <span>{t.common.pace}</span>
                    <span className="th-sub">{t.browse.averagePeak}</span>
                  </div>
                </th>
                <th title={t.browse.hrSummaryTooltip}>
                  <div className="th-stacked">
                    <span>{t.common.heartRate}</span>
                    <span className="th-sub">{t.browse.peakAverage}</span>
                  </div>
                </th>
                <th>
                  <div className="th-stacked">
                    <span>{t.browse.dynamicsTitle}</span>
                  </div>
                </th>
                <th>
                  <div className="th-stacked">
                    <span>{t.browse.recoveryDrop}</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayedIntervals.map((inv: ActivityInterval) => {
                const isFirst = inv.interval_index === 1;
                const isLast = inv.interval_index === allIntervals.length;
                const isWarmup = isFirst && inv.duration_seconds > 180 && inv.type === 'recovery';
                const isCooldown = isLast && inv.duration_seconds > 180 && inv.type === 'recovery';

                const allIdx = allIntervals.findIndex((x: ActivityInterval) => x.id === inv.id);
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
                          <span className="workreps-sub">→ {formatPrescriptionClock(snapped)}</span>
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
                          {formatPace(inv.avg_pace_sec_km ?? 0)}<span className="val-unit">/km</span>
                        </span>
                        {inv.peak_pace_sec_km && inv.peak_pace_sec_km < (inv.avg_pace_sec_km ?? Infinity) && (
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
                              {format(t.browse.averageHr, { value: inv.avg_heart_rate })}
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
                          <span><span className="workreps-dyn-label">{t.browse.cadenceShort} </span><b>{inv.avg_cadence ?? '—'}</b> <span className="workreps-dyn-label">spm</span></span>
                          <span>
                            <span className="workreps-dyn-label">{t.browse.gctShort} </span>
                            <b>{inv.avg_stance_time != null ? Math.round(inv.avg_stance_time) : (inv.min_stance_time != null ? Math.round(inv.min_stance_time) : '—')}</b>
                            <span className="workreps-dyn-label"> ms</span>
                          </span>
                        </span>
                        <span className="workreps-dyn-line">
                          <span>
                            <span className="workreps-dyn-label">{t.browse.verticalOscLabelShort} </span>
                            <b>{inv.avg_vert_osc != null ? Math.round(Number(inv.avg_vert_osc) < 25 ? Number(inv.avg_vert_osc) * 10 : Number(inv.avg_vert_osc)) : '—'}</b>
                            <span className="workreps-dyn-label"> mm</span>
                          </span>
                          <span>
                            <span className="workreps-dyn-label">{t.browse.strideLengthShort} </span>
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
                                <span className="workreps-dyn-label"> {t.browse.verticalRatioShort}</span>
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
          {t.browse.noIntervals}
        </div>
      )}
    </section>
  );
};
