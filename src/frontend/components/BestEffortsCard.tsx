import React, { useState, useEffect } from 'react';
import { Trophy, Clock, Calendar, Zap, Medal } from 'lucide-react';
import { formatPace } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';

export interface BestEffortRecord {
  targetId: string;
  label: string;
  distanceMeters: number;
  timeSeconds: number;
  paceSecKm: number;
  activityId: string;
  activityName: string;
  activityDate: string;
}

export interface BestEffortsResponse {
  allTime: BestEffortRecord[];
  currentYear: BestEffortRecord[];
}

export const BestEffortsCard: React.FC = () => {
  const { t, language } = useTranslation();
  const [data, setData] = useState<BestEffortsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [viewScope, setViewScope] = useState<'allTime' | 'currentYear'>('allTime');

  const currentYear = new Date().getFullYear();

  useEffect(() => {
    fetch('/api/activities/best-efforts')
      .then(res => res.json())
      .then(json => {
        setData(json);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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
          {language === 'zh' ? '正在加载最佳成绩...' : 'Loading best efforts...'}
        </div>
      </div>
    );
  }

  const efforts = (data && Array.isArray(data[viewScope])) ? data[viewScope] : [];

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Trophy size={18} color="var(--accent-amber)" />
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {language === 'zh' ? '个人最佳成绩 (Best Efforts)' : 'Personal Best Efforts'}
            </h3>
            <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              {language === 'zh' ? '基于历史跑步GPS与秒级分段数据' : 'Fastest continuous segments from workout telemetry'}
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
            {language === 'zh' ? '历史最佳' : 'All-Time PRs'}
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
      {efforts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {language === 'zh' ? '暂无匹配的标准距离成绩' : 'No benchmark records logged for this period yet.'}
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '0.75rem'
        }}>
          {efforts.map(e => (
            <div
              key={e.targetId}
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
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-amber)' }}>
                  {e.label}
                </span>
                <Medal size={13} color="var(--accent-amber)" style={{ opacity: 0.8 }} />
              </div>

              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {formatSeconds(e.timeSeconds)}
              </div>

              <div style={{ fontSize: '0.74rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                {formatPace(e.paceSecKm)}
              </div>

              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.activityName}>
                {e.activityDate ? e.activityDate.substring(0, 10) : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
