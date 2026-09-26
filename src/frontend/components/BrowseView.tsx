import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { Activity, ActivityDetailResponse, ActivityInterval, ActivityUpdate } from '../types/api.js';
import { getActivityDetail, refreshActivityWeather } from '../api/client.js';
import type { Translations } from '../i18n/types.js';
import {
  HeartPulse,
  Plus,
  RefreshCw,
  AlertTriangle,
  Zap,
  Compass
} from 'lucide-react';
import { CanvasRunChart } from './CanvasRunChart';
import { KmSplitsVisualizer } from './KmSplitsVisualizer.js';
import { formatPace as formatPaceUtil } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { BrowseSidebar } from './browse/BrowseSidebar.js';
import { ActivityDetailHeader } from './browse/ActivityDetailHeader.js';
import { CoachScoreCard } from './browse/CoachScoreCard.js';
import { IntervalsTable } from './browse/IntervalsTable.js';


/** A workout row as used by the browse list. Same shape as the API contract. */
export type ActivitySummary = Activity;

export interface BrowseViewProps {
  activities: ActivitySummary[];
  selectedActivityId: string | null;
  dataRefreshKey?: number;
  onSelectActivity: (id: string) => void;
  onOpenUpload: () => void;
  onActivityUpdated?: (activity: ActivityUpdate) => void;
  theme?: 'dark' | 'light';
}

/** The subset of a workout row needed to derive a display title. */
export type DisplayTitleInput = Pick<Activity, 'name' | 'run_type'> & Partial<Pick<Activity, 'distance_meters'>>;

export type DisplayTitleFn = (activity: DisplayTitleInput, t?: Translations) => string;

export function getDisplayTitle(activity: DisplayTitleInput, t?: Translations): string {
  const rawName = activity.name || '';
  const isGenericGarminName = rawName.endsWith('Running') || rawName.endsWith('Run') || rawName === 'Singapore Running' || rawName === 'Singapore Intervals';

  if (!isGenericGarminName && rawName.trim() !== '') {
    return rawName;
  }

  if (t?.browse?.defaultTitles) {
    const key = activity.run_type || '';
    const defaultTitle = (t.browse.defaultTitles as Record<string, string | undefined>)[key];
    if (defaultTitle) {
      return defaultTitle;
    }
  }

  const typeTitles: Record<string, string> = {
    easy_base: 'Easy Aerobic Base',
    long_run: 'Endurance Long Run',
    threshold_lt2: 'Lactate Threshold (LT2)',
    intervals_vo2: 'VO2 Max Intervals',
    recovery: 'Recovery Jog',
    strides: 'Base + Strides',
    tempo: 'Marathon / Tempo Pace',
    failed_workout: 'Aborted / Failed Workout',
    accidental_tempo: 'Unplanned Tempo',
    race: rawName || 'Race'
  };

  return typeTitles[activity.run_type || ''] || 'Aerobic Run';
}

export function doesActivityMatchTag(a: ActivitySummary, tag: string): boolean {
  if (!tag || tag.toLowerCase() === 'all') return true;
  const lower = tag.toLowerCase();
  let tagsArr: string[] = [];
  try {
    tagsArr = a.tags ? JSON.parse(a.tags) : [];
  } catch {
    tagsArr = [];
  }
  if (tagsArr.some(t => t.toLowerCase() === lower)) return true;
  if (lower === 'threshold' && (a.run_type === 'threshold_lt2' || a.run_type === 'tempo')) return true;
  if (lower === 'vo2 max' && a.run_type === 'intervals_vo2') return true;
  if (lower === 'easy base' && a.run_type === 'easy_base') return true;
  if (lower === 'long run' && a.run_type === 'long_run') return true;
  if (lower === 'race' && a.run_type === 'race') return true;
  if (lower === 'recovery' && a.run_type === 'recovery') return true;
  if (lower === 'tempo' && a.run_type === 'tempo') return true;
  if (lower === 'marathon pace' && tagsArr.some(t => t.toLowerCase().includes('marathon'))) return true;
  if (lower === 'strides' && (a.run_type === 'strides' || tagsArr.some(t => t.toLowerCase().includes('stride')))) return true;
  return false;
}

const SIDEBAR_FILTER_TAGS = [
  'All', 'Threshold', 'VO2 Max', 'Easy Base', 'Long Run', 'Race', 'Strides', 'Marathon Pace', 'Recovery'
];

export const BrowseView: React.FC<BrowseViewProps> = ({
  activities = [],
  selectedActivityId,
  dataRefreshKey = 0,
  onSelectActivity,
  onOpenUpload,
  onActivityUpdated,
  theme = 'dark'
}) => {
  const safeActivities = useMemo(() => (Array.isArray(activities) ? activities : []), [activities]);
  const { t, language, format, formatDate } = useTranslation();
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState<boolean>(false);
  const [calendarViewYm, setCalendarViewYm] = useState<string>(() => {
    return safeActivities[0]?.start_time ? safeActivities[0].start_time.substring(0, 7) : new Date().toISOString().substring(0, 7);
  });
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('all');
  const [activeSubTab, setActiveSubTab] = useState<'telemetry' | 'splits' | 'strides' | 'coach'>('telemetry');
  const [mobileSubTab, setMobileSubTab] = useState<'list' | 'detail'>('list');
  const [showTagMenu, setShowTagMenu] = useState<boolean>(false);
  const tagMenuRef = useRef<HTMLDivElement>(null);

  // Auto-dismiss tag menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setShowTagMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowTagMenu(false);
      }
    };
    if (showTagMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showTagMenu]);

  // Auto-dismiss tag menu on activity change
  useEffect(() => {
    setShowTagMenu(false);
  }, [selectedActivityId]);

  const [detailData, setDetailData] = useState<ActivityDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState<number>(0);
  const [isRefreshingWeather, setIsRefreshingWeather] = useState<boolean>(false);

  const handleRefreshWeather = async () => {
    if (!selectedActivityId) return;
    setIsRefreshingWeather(true);
    try {
      const data = await refreshActivityWeather(selectedActivityId);
      setDetailData(prev => prev ? {
        ...prev,
        activity: { ...prev.activity, ...data.activity },
        coachSummary: data.coachSummary || prev.coachSummary
      } : null);
    } catch (err) {
      console.error('Failed to refresh microclimate weather:', err);
    } finally {
      setIsRefreshingWeather(false);
    }
  };

  // Pre-calculate count of activities matching each sidebar tag
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = { All: safeActivities.length };
    SIDEBAR_FILTER_TAGS.forEach(tag => {
      if (tag === 'All') return;
      counts[tag] = safeActivities.filter(a => doesActivityMatchTag(a, tag)).length;
    });
    return counts;
  }, [safeActivities]);

  // Derive unique years with recorded sessions for rapid year jumping
  const availableYears = useMemo(() => {
    const set = new Set<string>();
    safeActivities.forEach(a => {
      const yr = a.start_time?.substring(0, 4);
      if (yr) set.add(yr);
    });
    return Array.from(set).sort();
  }, [safeActivities]);

  // Map dates (YYYY-MM-DD) to activity IDs and run types for the calendar
  const activeDatesMap = useMemo(() => {
    const map = new Map<string, { count: number; runTypes: string[]; ids: string[] }>();
    safeActivities.forEach(a => {
      const dStr = a.start_time?.substring(0, 10);
      if (!dStr) return;
      if (!map.has(dStr)) {
        map.set(dStr, { count: 0, runTypes: [], ids: [] });
      }
      const entry = map.get(dStr)!;
      entry.count++;
      if (a.run_type && !entry.runTypes.includes(a.run_type)) {
        entry.runTypes.push(a.run_type);
      }
      entry.ids.push(a.id);
    });
    return map;
  }, [safeActivities]);

  const filteredActivities = useMemo(() => {
    return safeActivities.filter(a => {
      if (selectedDate) {
        return a.start_time?.startsWith(selectedDate);
      }
      if (selectedMonth !== 'all' && !a.start_time?.startsWith(selectedMonth)) {
        return false;
      }
      return doesActivityMatchTag(a, selectedTagFilter);
    });
  }, [safeActivities, selectedDate, selectedMonth, selectedTagFilter]);

  const groupedActivities = useMemo(() => {
    if (selectedMonth !== 'all') {
      return [{ ym: selectedMonth, title: '', items: filteredActivities, totalKm: 0 }];
    }
    const map = new Map<string, ActivitySummary[]>();
    filteredActivities.forEach(a => {
      const ym = a.start_time?.substring(0, 7) || 'Other';
      if (!map.has(ym)) map.set(ym, []);
      map.get(ym)!.push(a);
    });

    const groups: { ym: string; title: string; items: ActivitySummary[]; totalKm: number }[] = [];
    const sortedYms = Array.from(map.keys()).sort().reverse();
    sortedYms.forEach(ym => {
      const items = map.get(ym)!;
      const totalKm = items.reduce((sum, item) => sum + item.distance_meters, 0) / 1000;
      const dObj = new Date(`${ym}-01`);
      const title = ym === 'Other'
        ? t.browse.otherGroup
        : formatDate(dObj, { month: 'long', year: 'numeric' });
      groups.push({ ym, title, items, totalKm: Number(totalKm.toFixed(1)) });
    });
    return groups;
  }, [filteredActivities, selectedMonth, formatDate, t]);

  // Auto-select first activity on initial mount only
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (!didAutoSelect.current && !selectedActivityId && safeActivities.length > 0) {
      didAutoSelect.current = true;
      onSelectActivity(safeActivities[0].id);
    }
  }, [safeActivities, selectedActivityId, onSelectActivity]);

  const prevSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedActivityId || safeActivities.length === 0) return;
    const isDifferent = prevSelectedIdRef.current !== null && prevSelectedIdRef.current !== selectedActivityId;
    prevSelectedIdRef.current = selectedActivityId;

    if (!isDifferent) return;

    const target = safeActivities.find(a => a.id === selectedActivityId);
    if (!target) return;

    if (selectedMonth !== 'all' && !target.start_time?.startsWith(selectedMonth)) {
      setSelectedMonth('all');
    }
    if (selectedTagFilter !== 'all' && !doesActivityMatchTag(target, selectedTagFilter)) {
      setSelectedTagFilter('all');
    }

    setMobileSubTab('detail');
  }, [selectedActivityId, safeActivities]);

  useEffect(() => {
    if (!selectedActivityId) return;

    const controller = new AbortController();
    setLoadingDetail(true);
    setDetailError(null);
    getActivityDetail(selectedActivityId, controller.signal)
      .then(data => {
        setDetailData(data);
        if (!data.intervals || data.intervals.length === 0) {
          setActiveSubTab(prev => (prev === 'strides' ? 'telemetry' : prev));
        }
        if (!data.splits || data.splits.length === 0) {
          setActiveSubTab(prev => (prev === 'splits' ? 'telemetry' : prev));
        }
        if (data.coachSummary != null && onActivityUpdated) {
          onActivityUpdated({
            id: selectedActivityId,
            verdict: data.coachSummary.verdict,
            run_type: data.activity?.run_type,
            name: data.activity?.name,
            tags: data.activity?.tags
          });
        }
        setDetailError(null);
        setLoadingDetail(false);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        console.error('Failed to load activity detail:', err);
        setDetailError(err.message || 'Failed to load activity telemetry profile');
        setLoadingDetail(false);
      });

    return () => controller.abort();
  }, [selectedActivityId, retryCounter, dataRefreshKey]);

  const act = detailData?.activity;

  const intervalsTabVisible = useMemo(() => {
    const list = detailData?.intervals || [];
    if (list.length === 0) return false;
    const runType = detailData?.activity?.run_type;
    if (runType === 'threshold_lt2' || runType === 'intervals_vo2' || runType === 'race') return true;
    return list.some((i: ActivityInterval) => i.type === 'stride');
  }, [detailData]);

  useEffect(() => {
    if (!intervalsTabVisible) {
      setActiveSubTab(prev => (prev === 'strides' ? 'telemetry' : prev));
    }
  }, [intervalsTabVisible]);

  const formatPace = (secKm: number | null) => formatPaceUtil(secKm, false);

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remainingSec = Math.round(sec % 60);
    return `${mins}:${String(remainingSec).padStart(2, '0')}`;
  };

  const getTimeOfDay = (dateStr: string) => {
    const d = new Date(dateStr);
    const hour = d.getHours();
    if (hour >= 5 && hour < 11) return t.browse.timeOfDayMorning;
    if (hour >= 11 && hour < 16) return t.browse.timeOfDayMidday;
    if (hour >= 16 && hour < 19) return t.browse.timeOfDayEvening;
    return t.browse.timeOfDayNight;
  };

  return (
    <div className={`browse-grid ${mobileSubTab === 'detail' ? 'mobile-show-detail' : 'mobile-show-list'}`}>
      {/* Mobile list/detail switcher (< 768px) */}
      <div className="mobile-browse-segmented-control" role="tablist" aria-label={t.browse.viewSwitcherLabel}>
        <button
          type="button"
          className={`mobile-browse-tab-btn ${mobileSubTab === 'list' ? 'active' : ''}`}
          onClick={() => setMobileSubTab('list')}
        >
          {format(t.browse.sessionsCount, { count: filteredActivities.length })}
        </button>
        <button
          type="button"
          className={`mobile-browse-tab-btn ${mobileSubTab === 'detail' ? 'active' : ''}`}
          onClick={() => setMobileSubTab('detail')}
        >
          {t.browse.tabTelemetry}
        </button>
      </div>

      {/* Left Sidebar: Sessions List & Interactive Calendar Picker */}
      <BrowseSidebar
        filteredActivities={filteredActivities}
        groupedActivities={groupedActivities}
        tagCounts={tagCounts}
        selectedTagFilter={selectedTagFilter}
        setSelectedTagFilter={setSelectedTagFilter}
        selectedActivityId={selectedActivityId}
        onSelectActivity={onSelectActivity}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        selectedMonth={selectedMonth}
        setSelectedMonth={setSelectedMonth}
        showCalendar={showCalendar}
        setShowCalendar={setShowCalendar}
        calendarViewYm={calendarViewYm}
        setCalendarViewYm={setCalendarViewYm}
        availableYears={availableYears}
        activeDatesMap={activeDatesMap}
        setMobileSubTab={setMobileSubTab}
        setShowTagMenu={setShowTagMenu}
        onOpenUpload={onOpenUpload}
        getDisplayTitle={getDisplayTitle}
        formatPace={formatPace}
        language={language}
        t={t}
        activitiesCount={safeActivities.length}
      />

      {/* Right Main Panel: Run Details */}
      <main className="detail-panel">
        {safeActivities.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              background: 'var(--bg-card)',
              borderRadius: 14,
              border: '1px dashed var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              boxShadow: 'var(--card-shadow)'
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 16,
                background: 'rgba(6, 182, 212, 0.12)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <HeartPulse size={30} color="#38bdf8" />
            </div>
            <h3 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              {t.browse.readyFirstRunTitle}
            </h3>
            <p style={{ maxWidth: 460, color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.55, margin: 0 }}>
              {t.browse.readyFirstRunDesc}
            </p>
            <button
              onClick={onOpenUpload}
              style={{
                marginTop: '0.5rem',
                padding: '0.7rem 1.4rem',
                fontSize: '0.88rem',
                fontWeight: 700,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #0284c7, #06b6d4)',
                border: 'none',
                color: '#ffffff',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 4px 14px 0 rgba(6, 182, 212, 0.35)'
              }}
            >
              <Plus size={16} />
              <span>{t.browse.importFirstWorkoutBtn}</span>
            </button>
          </div>
        ) : detailError ? (
          <div
            style={{
              padding: '3rem 2rem',
              background: 'var(--bg-card)',
              borderRadius: 14,
              border: '1px solid rgba(244, 63, 94, 0.3)',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              boxShadow: 'var(--card-shadow)',
              minHeight: 280
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'rgba(244, 63, 94, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f43f5e'
              }}
            >
              <AlertTriangle size={24} />
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.browse.telemetryLoadFailed}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: 420 }}>
              {detailError}
            </div>
            <button
              onClick={() => setRetryCounter(c => c + 1)}
              style={{
                padding: '0.55rem 1.25rem',
                borderRadius: 8,
                background: '#06b6d4',
                color: '#07090e',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem'
              }}
            >
              <RefreshCw size={14} />
              <span>{t.common.retry}</span>
            </button>
          </div>
        ) : loadingDetail || !act ? (
          <div
            className="overview-card loading-skeleton"
            style={{
              height: 350,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.85rem',
              border: '1px solid var(--border-subtle)'
            }}
          >
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid rgba(6,182,212,0.2)', borderTopColor: '#06b6d4', animation: 'spin 0.8s linear infinite' }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>
              {t.browse.loadingTelemetry}
            </span>
          </div>
        ) : (
          <>
            {/* Mobile Back Button (< 768px) */}
            <div className="mobile-back-to-sessions-bar">
              <button
                type="button"
                className="mobile-back-btn"
                onClick={() => setMobileSubTab('list')}
              >
                ← {t.browse.backToSessions}
              </button>
            </div>

            {/* Overview Header Card */}
            <ActivityDetailHeader
              act={act}
              records={detailData.records}
              getDisplayTitle={getDisplayTitle}
              formatPace={formatPace}
              formatTime={formatTime}
              getTimeOfDay={getTimeOfDay}
              onActivityUpdated={(updated) => {
                setDetailData(prev => prev ? { ...prev, activity: { ...prev.activity, ...updated } } : prev);
                onActivityUpdated?.(updated);
              }}
              onRefreshWeather={handleRefreshWeather}
              isRefreshingWeather={isRefreshingWeather}
              showTagMenu={showTagMenu}
              setShowTagMenu={setShowTagMenu}
              tagMenuRef={tagMenuRef}
              t={t}
            />

            {/* Sub-Tabs Selector for Main Panel */}
            <div className="detail-subtabs" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
              <button
                id="subtab-telemetry-btn"
                className={`filter-pill-btn ${activeSubTab === 'telemetry' ? 'active' : ''}`}
                onClick={() => setActiveSubTab('telemetry')}
              >
                {t.browse.tabTelemetry}
              </button>
              {(detailData.splits?.length ?? 0) > 0 && (
                <button
                  id="subtab-splits-btn"
                  className={`filter-pill-btn ${activeSubTab === 'splits' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('splits')}
                >
                  {t.browse.tabSplits} ({detailData.splits.length})
                </button>
              )}
              {intervalsTabVisible && (
                <button
                  id="subtab-strides-btn"
                  className={`filter-pill-btn ${activeSubTab === 'strides' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('strides')}
                >
                  {t.browse.tabIntervals} ({detailData.intervals.filter(interval => interval.type === 'work' || interval.type === 'stride').length})
                </button>
              )}
              <button
                id="subtab-coach-btn"
                className={`filter-pill-btn ${activeSubTab === 'coach' ? 'active' : ''}`}
                onClick={() => setActiveSubTab('coach')}
              >
                {t.browse.tabCoach}
              </button>
            </div>

            {/* SUBTAB 1: Telemetry & Chart */}
            {activeSubTab === 'telemetry' && (
              <>
                <section className="chart-card">
                  <div className="chart-header">
                    <span className="chart-title">Elevation & Telemetry Profile</span>
                  </div>

                  <CanvasRunChart
                    records={detailData.records || []}
                    theme={theme}
                  />
                </section>

                <div className="goal-markers-grid">
                  <div className="goal-card">
                    <div className="goal-card-header">
                      <span className="goal-card-title">{t.browse.aerobicDecoupling}</span>
                      <HeartPulse size={18} color="#06b6d4" />
                    </div>
                    <div className="goal-stat-highlight" style={{ color: (act.aerobic_decoupling_pct ?? 0) < 4.5 ? '#10b981' : '#f59e0b' }}>
                      {act.aerobic_decoupling_pct != null ? `${act.aerobic_decoupling_pct.toFixed(1)}%` : '—'}
                    </div>
                    <p className="goal-stat-desc">
                      {(act.aerobic_decoupling_pct ?? 0) < 4.5
                        ? t.browse.aerobicDecouplingDescSolid
                        : t.browse.aerobicDecouplingDescDrift}
                    </p>
                  </div>

                  <div className="goal-card">
                    <div className="goal-card-header">
                      <span className="goal-card-title">{t.browse.efficiencyFactor}</span>
                      <Zap size={18} color="#10b981" />
                    </div>
                    <div className="goal-stat-highlight" style={{ color: '#10b981' }}>
                      {act.efficiency_factor ? `${act.efficiency_factor.toFixed(2)}` : '—'}
                      <span style={{ fontSize: '0.85rem', color: '#94a3b8', marginLeft: '0.3rem' }}>{t.browse.efficiencyFactorUnits}</span>
                    </div>
                    <p className="goal-stat-desc">
                      {act.meters_per_beat ? `${act.meters_per_beat.toFixed(2)} ${t.browse.metersPerHeartbeatDesc}` : t.browse.efficiencyDefaultDesc}
                    </p>
                  </div>

                  <div className="goal-card">
                    <div className="goal-card-header">
                      <span className="goal-card-title">{t.browse.biomechanicalDynamics}</span>
                      <Compass size={18} color="#8b5cf6" />
                    </div>
                    <div className="goal-stat-highlight" style={{ color: '#8b5cf6', fontSize: '1.4rem' }}>
                      {act.avg_stance_time ? `${Math.round(act.avg_stance_time)} ms` : '—'}
                      <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginLeft: '0.5rem' }}>
                        {t.browse.gctShort} • {act.avg_vertical_oscillation ? `${(act.avg_vertical_oscillation / 10).toFixed(1)} ${t.browse.verticalOscShort}` : ''}
                      </span>
                    </div>
                    <p className="goal-stat-desc">
                      {t.browse.biomechanicalDesc}
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* SUBTAB: KM Splits & Pace Variation (Full Interactive Mode) */}
            {activeSubTab === 'splits' && (
              <KmSplitsVisualizer
                splits={detailData.splits || []}
                overallAvgPace={act.avg_pace_sec_km}
                overallAvgHr={act.avg_heart_rate}
                lt1Hr={detailData.heartRateThresholds?.lt1Hr ?? undefined}
                lt2Hr={detailData.heartRateThresholds?.lt2Hr ?? undefined}
                compact={false}
              />
            )}

            {/* SUBTAB 2: Strides & Intervals */}
            {activeSubTab === 'strides' && intervalsTabVisible && (
              <IntervalsTable
                intervals={detailData.intervals || []}
                activityRunType={detailData.activity?.run_type ?? undefined}
                formatPace={formatPace}
                formatTime={formatTime}
              />
            )}

            {/* SUBTAB 3: Session Analysis */}
            {activeSubTab === 'coach' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {detailData.coachSummary && (
                  <CoachScoreCard
                    coachSummary={detailData.coachSummary}
                    language={language}
                    t={t}
                  />
                )}

              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
