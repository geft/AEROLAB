import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  HeartPulse,
  Plus,
  RefreshCw,
  AlertTriangle,
  FileText,
  Zap,
  Compass
} from 'lucide-react';
import { CanvasRunChart } from './CanvasRunChart';
import { KmSplitsVisualizer } from './KmSplitsVisualizer.js';
import { formatPace as formatPaceUtil } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { BrowseSidebar } from './browse/BrowseSidebar.js';
import { ActivityDetailHeader } from './browse/ActivityDetailHeader.js';
import { CoachScoreCard, scoreToStars } from './browse/CoachScoreCard.js';
import { IntervalsTable } from './browse/IntervalsTable.js';

export { scoreToStars };

export interface ActivitySummary {
  id: string;
  start_time: string;
  name: string;
  run_type: string;
  distance_meters: number;
  duration_seconds: number;
  avg_pace_sec_km: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_cadence: number | null;
  calories: number;
  elevation_gain_m: number | null;
  avg_temperature: number | null;
  avg_vertical_oscillation: number | null;
  avg_stance_time: number | null;
  efficiency_factor: number | null;
  aerobic_decoupling_pct: number | null;
  meters_per_beat: number | null;
  tags?: string;
  steady_pace_sec_km?: number | null;
  steady_heart_rate?: number | null;
  steady_cadence?: number | null;
  steady_stance_time?: number | null;
  pause_duration_seconds?: number | null;
  walk_duration_seconds?: number | null;
  walk_distance_meters?: number | null;
  workout_lat?: number | null;
  workout_lon?: number | null;
  weather_temperature_c?: number | null;
  weather_humidity_pct?: number | null;
  weather_apparent_temp_c?: number | null;
  weather_condition?: string | null;
  weather_code?: number | null;
  weather_fetched_at?: string | null;
  effectiveness_score?: number | null;
}

export interface BrowseViewProps {
  activities: ActivitySummary[];
  selectedActivityId: string | null;
  onSelectActivity: (id: string) => void;
  onOpenUpload: () => void;
  onActivityUpdated?: (activity: any) => void;
  theme?: 'dark' | 'light';
}

export function getDisplayTitle(activity: { name?: string; run_type?: string; distance_meters?: number }, t?: any): string {
  const rawName = activity.name || '';
  const isGenericGarminName = rawName.endsWith('Running') || rawName.endsWith('Run') || rawName === 'Singapore Running' || rawName === 'Singapore Intervals';

  if (!isGenericGarminName && rawName.trim() !== '') {
    return rawName;
  }

  if (t?.browse?.defaultTitles) {
    const key = activity.run_type || '';
    if ((t.browse.defaultTitles as any)[key]) {
      return (t.browse.defaultTitles as any)[key];
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
  onSelectActivity,
  onOpenUpload,
  onActivityUpdated,
  theme = 'dark'
}) => {
  const safeActivities = useMemo(() => (Array.isArray(activities) ? activities : []), [activities]);
  const { t, language, formatDate } = useTranslation();
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState<boolean>(false);
  const [calendarViewYm, setCalendarViewYm] = useState<string>(() => {
    return safeActivities[0]?.start_time ? safeActivities[0].start_time.substring(0, 7) : new Date().toISOString().substring(0, 7);
  });
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('all');
  const [focusCoreSegment, setFocusCoreSegment] = useState<boolean>(false);
  const [activeSubTab, setActiveSubTab] = useState<'telemetry' | 'splits' | 'strides' | 'notes'>('telemetry');
  const [runnerNotes, setRunnerNotes] = useState<string>('');
  const [isSavingNotes, setIsSavingNotes] = useState<boolean>(false);
  const [notesSaveStatus, setNotesSaveStatus] = useState<string | null>(null);
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

  const [detailData, setDetailData] = useState<{
    activity: any;
    splits: any[];
    intervals: any[];
    records: any[];
    coachSummary: any;
    heartRateThresholds?: { lt1Hr: number; lt2Hr: number };
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState<number>(0);
  const [isRefreshingWeather, setIsRefreshingWeather] = useState<boolean>(false);

  const handleRefreshWeather = async () => {
    if (!selectedActivityId) return;
    setIsRefreshingWeather(true);
    try {
      const res = await fetch(`/api/activities/${selectedActivityId}/weather/refresh`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setDetailData(prev => prev ? {
          ...prev,
          activity: {
            ...prev.activity,
            ...data.activity
          },
          coachSummary: data.coachSummary || prev.coachSummary
        } : null);
      }
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
    fetch(`/api/activities/${selectedActivityId}`, { signal: controller.signal })
      .then(async res => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server returned error (${res.status})`);
        }
        return res.json();
      })
      .then(data => {
        setDetailData(data);
        setRunnerNotes(data.activity?.notes || '');
        if (!data.intervals || data.intervals.length === 0) {
          setActiveSubTab(prev => (prev === 'strides' ? 'telemetry' : prev));
        }
        if (!data.splits || data.splits.length === 0) {
          setActiveSubTab(prev => (prev === 'splits' ? 'telemetry' : prev));
        }
        if (data.coachSummary?.effectivenessScore != null && onActivityUpdated) {
          onActivityUpdated({
            id: selectedActivityId,
            effectiveness_score: data.coachSummary.effectivenessScore,
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
  }, [selectedActivityId, retryCounter]);

  const act = detailData?.activity;

  const intervalsTabVisible = useMemo(() => {
    const list = detailData?.intervals || [];
    if (list.length === 0) return false;
    const runType = detailData?.activity?.run_type;
    if (runType === 'threshold_lt2' || runType === 'intervals_vo2' || runType === 'race') return true;
    return list.some((i: any) => i.type === 'stride');
  }, [detailData]);

  useEffect(() => {
    if (!intervalsTabVisible) {
      setActiveSubTab(prev => (prev === 'strides' ? 'telemetry' : prev));
    }
  }, [intervalsTabVisible]);

  useEffect(() => {
    if (act) {
      setRunnerNotes(act.notes || '');
    }
  }, [act?.id, act?.notes]);

  const handleSaveNotes = async () => {
    if (!act) return;
    setIsSavingNotes(true);
    setNotesSaveStatus(null);
    try {
      const res = await fetch(`/api/activities/${act.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: runnerNotes })
      });
      if (res.ok) {
        setDetailData(prev => prev ? { ...prev, activity: { ...prev.activity, notes: runnerNotes } } : prev);
        setNotesSaveStatus('Saved!');
        setTimeout(() => setNotesSaveStatus(null), 2000);
      }
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const formatPace = (secKm: number | null) => formatPaceUtil(secKm, false);

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remainingSec = Math.round(sec % 60);
    return `${mins}:${String(remainingSec).padStart(2, '0')}`;
  };

  const getTimeOfDay = (dateStr: string) => {
    const d = new Date(dateStr);
    const hour = d.getHours();
    if (hour >= 5 && hour < 11) return 'Morning';
    if (hour >= 11 && hour < 16) return 'Midday';
    if (hour >= 16 && hour < 19) return 'Evening';
    return 'Night';
  };

  return (
    <div className={`browse-grid ${mobileSubTab === 'detail' ? 'mobile-show-detail' : 'mobile-show-list'}`}>
      {/* Mobile list/detail switcher (< 768px) */}
      <div className="mobile-browse-segmented-control" role="tablist" aria-label="Browse View Switcher">
        <button
          type="button"
          className={`mobile-browse-tab-btn ${mobileSubTab === 'list' ? 'active' : ''}`}
          onClick={() => setMobileSubTab('list')}
        >
          Sessions ({filteredActivities.length})
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
              Telemetry Profile Failed to Load
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
              <span>Retry Loading</span>
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
              Loading workout telemetry...
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
                ← Back to Sessions List
              </button>
            </div>

            {/* Overview Header Card */}
            <ActivityDetailHeader
              act={act}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
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
                  {t.browse.tabIntervals} ({detailData.intervals.length})
                </button>
              )}
              <button
                id="subtab-notes-btn"
                className={`filter-pill-btn ${activeSubTab === 'notes' ? 'active' : ''}`}
                onClick={() => setActiveSubTab('notes')}
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
                    <button
                      id="toggle-core-segment-btn"
                      className={`toggle-segment-btn ${focusCoreSegment ? 'active' : ''}`}
                      onClick={() => setFocusCoreSegment(!focusCoreSegment)}
                    >
                      {focusCoreSegment ? `✓ ${t.browse.showAll}` : t.browse.focusCore}
                    </button>
                  </div>

                  <CanvasRunChart
                    records={detailData.records || []}
                    focusCoreSegment={focusCoreSegment}
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
                      {act.aerobic_decoupling_pct !== null ? `${act.aerobic_decoupling_pct.toFixed(1)}%` : '—'}
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
                lt1Hr={detailData.heartRateThresholds?.lt1Hr}
                lt2Hr={detailData.heartRateThresholds?.lt2Hr}
                compact={false}
              />
            )}

            {/* SUBTAB 2: Strides & Intervals */}
            {activeSubTab === 'strides' && intervalsTabVisible && (
              <IntervalsTable
                intervals={detailData.intervals || []}
                activityRunType={detailData.activity?.run_type}
                formatPace={formatPace}
                formatTime={formatTime}
              />
            )}

            {/* SUBTAB 3: Notes & AI Coach */}
            {activeSubTab === 'notes' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {detailData.coachSummary && (
                  <CoachScoreCard
                    coachSummary={detailData.coachSummary}
                    language={language}
                    t={t}
                  />
                )}

                {/* Extended Notes Field */}
                <section className="data-table-card">
                  <div className="sidebar-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <FileText size={16} color="#06b6d4" />
                      <span className="sidebar-title">{t.browse.runnerNotesTitle}</span>
                    </div>
                    {notesSaveStatus && (
                      <span style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>{notesSaveStatus}</span>
                    )}
                  </div>

                  <textarea
                    rows={4}
                    value={runnerNotes}
                    onChange={e => setRunnerNotes(e.target.value)}
                    placeholder={t.browse.notesPlaceholder}
                    style={{
                      width: '100%',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      padding: '0.75rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      fontFamily: 'var(--font-body)',
                      resize: 'vertical'
                    }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                      onClick={() => { setRunnerNotes(''); }}
                      disabled={!runnerNotes}
                      style={{
                        background: 'transparent',
                        color: runnerNotes ? 'var(--text-muted)' : 'var(--border-subtle)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 6,
                        padding: '0.45rem 1rem',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        cursor: runnerNotes ? 'pointer' : 'default'
                      }}
                    >
                      {t.browse.clear}
                    </button>
                    <button
                      onClick={handleSaveNotes}
                      disabled={isSavingNotes}
                      style={{
                        background: '#06b6d4',
                        color: '#07090e',
                        border: 'none',
                        borderRadius: 6,
                        padding: '0.45rem 1.25rem',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        cursor: 'pointer'
                      }}
                    >
                      {isSavingNotes ? '...' : t.browse.saveNotes}
                    </button>
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
