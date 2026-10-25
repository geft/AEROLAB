import { useActivityRevision } from '../features/activity-revision.js';
import React, { useState, useEffect } from 'react';
import { Trophy, Medal } from 'lucide-react';
import { formatPace } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { getBestEfforts } from '../api/client.js';
import type { BestEffortSource } from '../../shared/best-efforts.js';

export interface BestEffortRecord {
  /** Missing only in older offline snapshots. */
  source?: BestEffortSource;
  targetId: string;
  label: string;
  distanceMeters: number;
  timeSeconds: number;
  paceSecKm: number;
  activityId: string;
  activityName: string;
  activityDate: string;
}

export interface BestEffortTarget {
  id: string;
  label: string;
  distanceMeters: number;
}

export interface BestEffortsResponse {
  allTime: BestEffortRecord[];
  currentYear: BestEffortRecord[];
  /** Every tracked benchmark distance, including those without a record yet. */
  targets?: BestEffortTarget[];
}

export const BestEffortsCard: React.FC = () => {
  const { t } = useTranslation();
  const revision = useActivityRevision();
  const [data, setData] = useState<BestEffortsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [viewScope, setViewScope] = useState<'allTime' | 'currentYear'>('allTime');

  const currentYear = new Date().getFullYear();

  useEffect(() => {
    const controller = new AbortController();
    getBestEfforts(controller.signal).then(json => {
      if (controller.signal.aborted) return;
      setData(json);
      setLoading(false);
    }).catch(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  // Render every tracked distance so benchmarks without a result yet (e.g. a
  // Marathon) still occupy a placeholder slot instead of vanishing.
  // Declared before the loading early-return to keep hook order stable.
  const targets: BestEffortTarget[] = React.useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data.targets) && data.targets.length > 0) return data.targets;

    // Backwards-compatible fallback for payloads without a `targets` list
    const derived = new Map<string, BestEffortTarget>();
    [...(data.allTime || []), ...(data.currentYear || [])].forEach(record => {
      if (!derived.has(record.targetId)) {
        derived.set(record.targetId, {
          id: record.targetId,
          label: record.label,
          distanceMeters: record.distanceMeters
        });
      }
    });
    return [...derived.values()];
  }, [data]);

  const formatSeconds = (sec: number): string => {
    if (!sec || isNaN(sec)) return '--:--';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hrs > 0) {
      return `${hrs}:${pad(mins)}:${pad(s)}`;
    }
    return `${mins}:${pad(s)}`;
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: '1.25rem', minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {t.bestEfforts.loading}
        </div>
      </div>
    );
  }

  const efforts = (data && Array.isArray(data[viewScope])) ? data[viewScope] : [];

  const getLocalizedDistanceLabel = (label: string): string =>
    t.bestEfforts.distanceLabels[label] || label;

  // A timing-mat result is not an estimate and not a GPS segment; the badge has
  // to say which, because the number alone cannot tell them apart.
  const sourceCopy: Record<BestEffortSource, { label: string; description: string }> = {
    official: { label: t.bestEfforts.official, description: t.bestEfforts.officialDescription },
    measured: { label: t.bestEfforts.measured, description: t.bestEfforts.measuredDescription },
    estimated: { label: t.bestEfforts.estimated, description: t.bestEfforts.estimatedDescription }
  };

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Trophy size={18} color="var(--accent-amber)" />
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.bestEfforts.title}
            </h3>
            <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {t.bestEfforts.subtitle}
            </p>
          </div>
        </div>

        {/* Scope Toggle */}
        <div className="volume-tabs" style={{ margin: 0 }}>
          <button
            type="button"
            className={`volume-tab-btn ${viewScope === 'allTime' ? 'active' : ''}`}
            onClick={() => setViewScope('allTime')}
          >
            {t.bestEfforts.allTime}
          </button>
          <button
            type="button"
            className={`volume-tab-btn ${viewScope === 'currentYear' ? 'active' : ''}`}
            onClick={() => setViewScope('currentYear')}
          >
            {currentYear}
          </button>
        </div>
      </div>

      {/* Efforts Grid */}
      {targets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {t.bestEfforts.empty}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '0.75rem'
        }}>
          {targets.map(target => {
            const e = efforts.find(record => record.targetId === target.id);
            const isEmpty = !e;
            return (
              <div
                key={target.id}
                style={{
                  background: 'var(--bg-surface)',
                  padding: '0.8rem 0.9rem',
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: isEmpty ? 'var(--text-secondary)' : 'var(--accent-amber)' }}>
                    {getLocalizedDistanceLabel(target.label)}
                  </span>
                  <Medal size={13} color="var(--accent-amber)" style={{ opacity: isEmpty ? 0.25 : 0.8 }} />
                </div>

                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: isEmpty ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                  {formatSeconds(e ? e.timeSeconds : 0)}
                </div>

                {e?.source && (
                  <span title={sourceCopy[e.source].description}
                    style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                    {sourceCopy[e.source].label}
                  </span>
                )}

                <div style={{ fontSize: '0.74rem', color: isEmpty ? 'var(--text-muted)' : 'var(--accent-cyan)', fontWeight: 600 }}>
                  {isEmpty ? '—' : formatPace(e!.paceSecKm)}
                </div>

                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={isEmpty ? undefined : e!.activityName}>
                  {isEmpty ? '' : (e!.activityDate ? e!.activityDate.substring(0, 10) : '')}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
