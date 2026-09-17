import React, { useState, useEffect } from 'react';
import { Calendar, CloudRain, Flame, TrendingUp, Zap, Clock, ShieldCheck, HeartPulse, Compass, Edit2, Tag, Plus, X, Check, FileText, Activity as ActivityIcon, Droplets, RefreshCw, Thermometer, Sun, Cloud, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, HelpCircle, AlertTriangle } from 'lucide-react';
import { CanvasRunChart } from './CanvasRunChart';
import { KmSplitsVisualizer } from './KmSplitsVisualizer.js';
import { formatPace as formatPaceUtil } from '../utils/formatters.js';

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

interface BrowseViewProps {
  activities: ActivitySummary[];
  selectedActivityId: string | null;
  onSelectActivity: (id: string) => void;
  onOpenUpload: () => void;
  onActivityUpdated?: (activity: any) => void;
  theme?: 'dark' | 'light';
}

export function getDisplayTitle(activity: { name?: string; run_type?: string; distance_meters?: number }): string {
  const rawName = activity.name || '';
  const isGenericGarminName = rawName.endsWith('Running') || rawName.endsWith('Run') || rawName === 'Singapore Running' || rawName === 'Singapore Intervals';

  if (!isGenericGarminName && rawName.trim() !== '') {
    return rawName;
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

export function scoreToStars(score: number | null | undefined): number {
  if (score == null) return 0;
  // 3-tier system: 1 = Bronze (<70), 2 = Silver (70-84), 3 = Gold (>=85)
  if (score <= 3) return Math.min(3, Math.max(1, Math.round(score)));
  if (score >= 85) return 3;
  if (score >= 70) return 2;
  return 1;
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

const COMMON_TAG_PRESETS = [
  'Easy Base', 'Long Run', 'Recovery', 'Threshold', 'VO2 Max',
  'Tempo', 'Marathon Pace', 'Strides', 'Race'
];

const SIDEBAR_FILTER_TAGS = [
  'All', 'Threshold', 'VO2 Max', 'Easy Base', 'Long Run', 'Race', 'Strides', 'Marathon Pace', 'Recovery'
];

export const BrowseView: React.FC<BrowseViewProps> = ({
  activities,
  selectedActivityId,
  onSelectActivity,
  onOpenUpload,
  onActivityUpdated,
  theme = 'dark'
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState<boolean>(false);
  const [calendarViewYm, setCalendarViewYm] = useState<string>(() => {
    return activities[0]?.start_time ? activities[0].start_time.substring(0, 7) : new Date().toISOString().substring(0, 7);
  });
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('all');
  const [focusCoreSegment, setFocusCoreSegment] = useState<boolean>(false);
  const [activeSubTab, setActiveSubTab] = useState<'telemetry' | 'splits' | 'strides' | 'notes'>('telemetry');
  const [intervalFilter, setIntervalFilter] = useState<'work_only' | 'all'>('work_only');
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [customTitle, setCustomTitle] = useState<string>('');
  const [showTagMenu, setShowTagMenu] = useState<boolean>(false);
  const tagMenuRef = React.useRef<HTMLDivElement>(null);
  const [runnerNotes, setRunnerNotes] = useState<string>('');
  const [isSavingNotes, setIsSavingNotes] = useState<boolean>(false);
  const [notesSaveStatus, setNotesSaveStatus] = useState<string | null>(null);

  const [showScoreBreakdown, setShowScoreBreakdown] = useState<boolean>(false);
  const [mobileSubTab, setMobileSubTab] = useState<'list' | 'detail'>('list');

  // Auto-dismiss tag menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setShowTagMenu(false);
      }
    };
    if (showTagMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
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
  const tagCounts = React.useMemo(() => {
    const counts: Record<string, number> = { All: activities.length };
    SIDEBAR_FILTER_TAGS.forEach(tag => {
      if (tag === 'All') return;
      counts[tag] = activities.filter(a => doesActivityMatchTag(a, tag)).length;
    });
    return counts;
  }, [activities]);

  // Derive unique years with recorded sessions for rapid year jumping
  const availableYears = React.useMemo(() => {
    const set = new Set<string>();
    activities.forEach(a => {
      const yr = a.start_time.substring(0, 4);
      if (yr) set.add(yr);
    });
    return Array.from(set).sort();
  }, [activities]);


  // Map dates (YYYY-MM-DD) to activity IDs and run types for the calendar
  const activeDatesMap = React.useMemo(() => {
    const map = new Map<string, { count: number; runTypes: string[]; ids: string[] }>();
    activities.forEach(a => {
      const dStr = a.start_time.substring(0, 10);
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
  }, [activities]);

  const filteredActivities = React.useMemo(() => {
    return activities.filter(a => {
      // Date filter (exact day clicked on calendar)
      if (selectedDate) {
        return a.start_time.startsWith(selectedDate);
      }
      // Month filter
      if (selectedMonth !== 'all' && !a.start_time.startsWith(selectedMonth)) {
        return false;
      }
      // Tag filter
      return doesActivityMatchTag(a, selectedTagFilter);
    });
  }, [activities, selectedDate, selectedMonth, selectedTagFilter]);

  const groupedActivities = React.useMemo(() => {
    if (selectedMonth !== 'all') {
      return [{ ym: selectedMonth, title: '', items: filteredActivities, totalKm: 0 }];
    }
    const map = new Map<string, ActivitySummary[]>();
    filteredActivities.forEach(a => {
      const ym = a.start_time.substring(0, 7) || 'Other';
      if (!map.has(ym)) map.set(ym, []);
      map.get(ym)!.push(a);
    });

    const groups: { ym: string; title: string; items: ActivitySummary[]; totalKm: number }[] = [];
    const sortedYms = Array.from(map.keys()).sort().reverse();
    sortedYms.forEach(ym => {
      const items = map.get(ym)!;
      const totalKm = items.reduce((sum, item) => sum + item.distance_meters, 0) / 1000;
      const dObj = new Date(`${ym}-01`);
      const title = ym === 'Other' ? 'Other' : dObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      groups.push({ ym, title, items, totalKm: Number(totalKm.toFixed(1)) });
    });
    return groups;
  }, [filteredActivities, selectedMonth]);

  // Auto-select first activity on initial mount only (separate from fetch effect so it doesn't loop)
  const didAutoSelect = React.useRef(false);
  useEffect(() => {
    if (!didAutoSelect.current && !selectedActivityId && activities.length > 0) {
      didAutoSelect.current = true;
      onSelectActivity(activities[0].id);
    }
  }, [activities, selectedActivityId, onSelectActivity]);

  // Ensure that when user explicitly selects a new run (selectedActivityId changes):
  // 1. If an active month or tag filter would hide that new run, reset the filter so the activity is visible.
  // 2. Automatically switch mobile sub-tab to 'detail' so mobile runners immediately see their newly selected run.
  // Note: We do NOT reset selectedMonth/selectedTagFilter if the user changes the filter dropdown while an activity is selected.
  const prevSelectedIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!selectedActivityId || activities.length === 0) return;
    const isDifferent = prevSelectedIdRef.current !== null && prevSelectedIdRef.current !== selectedActivityId;
    prevSelectedIdRef.current = selectedActivityId;

    if (!isDifferent) return;

    const target = activities.find(a => a.id === selectedActivityId);
    if (!target) return;

    if (selectedMonth !== 'all' && !target.start_time.startsWith(selectedMonth)) {
      setSelectedMonth('all');
    }
    if (selectedTagFilter !== 'all' && !doesActivityMatchTag(target, selectedTagFilter)) {
      setSelectedTagFilter('all');
    }

    setMobileSubTab('detail');
  }, [selectedActivityId, activities]);

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
        // Propagate latest effectiveness score back to sidebar card so ratings never fall out of sync
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

  // Intervals tab is only meaningful for quality sessions (threshold / VO2 /
  // race work reps) or when stride intervals were actually detected. For
  // easy / long / recovery runs the whole run is steady work, so showing a
  // warmup/cooldown segment breakdown would be nonsense.
  const intervalsTabVisible = React.useMemo(() => {
    const list = detailData?.intervals || [];
    if (list.length === 0) return false;
    const runType = detailData?.activity?.run_type;
    if (runType === 'threshold_lt2' || runType === 'intervals_vo2' || runType === 'race') return true;
    return list.some((i: any) => i.type === 'stride');
  }, [detailData]);

  // Leave the intervals tab if the newly selected run has no visible intervals
  useEffect(() => {
    if (!intervalsTabVisible) {
      setActiveSubTab(prev => (prev === 'strides' ? 'telemetry' : prev));
    }
  }, [intervalsTabVisible]);

  // Keep notes synchronized when selected activity changes
  useEffect(() => {
    if (act) {
      setRunnerNotes(act.notes || '');
      setCustomTitle(act.name || '');
      setIsEditingTitle(false);
    }
  }, [act?.id, act?.notes, act?.name]);

  // Active tags parsed from JSON string
  const currentTags: string[] = React.useMemo(() => {
    if (!act?.tags) return [];
    try {
      const parsed = JSON.parse(act.tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [act?.tags]);

  const handleUpdateTags = async (updatedTags: string[]) => {
    if (!act) return;
    try {
      const res = await fetch(`/api/activities/${act.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: updatedTags })
      });
      if (res.ok) {
        setDetailData(prev => prev ? { ...prev, activity: { ...prev.activity, tags: JSON.stringify(updatedTags) } } : prev);
        onActivityUpdated?.({ id: act.id, tags: JSON.stringify(updatedTags) });
      }
    } catch (err) {
      console.error('Failed to update tags:', err);
    }
  };

  const handleAddTag = (tagToAdd: string) => {
    const trimmed = tagToAdd.trim();
    if (!trimmed || currentTags.includes(trimmed)) return;
    if (!COMMON_TAG_PRESETS.includes(trimmed)) return;
    const updated = [...currentTags, trimmed];
    handleUpdateTags(updated);
    setShowTagMenu(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const updated = currentTags.filter(t => t !== tagToRemove);
    handleUpdateTags(updated);
  };

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

  function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

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
          Run Analysis
        </button>
      </div>

      {/* Left Sidebar: Sessions List & Interactive Calendar Picker */}
      <aside className="sidebar-panel">
        <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', minWidth: 0 }}>
            <span className="sidebar-title" style={{ whiteSpace: 'nowrap' }}>Sessions</span>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              ({filteredActivities.length})
            </span>
          </div>

          <button
            type="button"
            id="calendar-toggle-btn"
            onClick={() => {
              setShowCalendar(prev => !prev);
              if (!showCalendar && activities.length > 0) {
                const targetYm = selectedDate
                  ? selectedDate.substring(0, 7)
                  : selectedMonth !== 'all'
                    ? selectedMonth
                    : (activities[0]?.start_time?.substring(0, 7) || calendarViewYm);
                setCalendarViewYm(targetYm);
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: showCalendar
                ? 'var(--accent-cyan)'
                : selectedDate || selectedMonth !== 'all'
                  ? 'rgba(6, 182, 212, 0.15)'
                  : 'rgba(255, 255, 255, 0.05)',
              color: showCalendar
                ? '#07090e'
                : selectedDate || selectedMonth !== 'all'
                  ? '#38bdf8'
                  : 'var(--text-primary)',
              border: showCalendar
                ? '1px solid var(--accent-cyan)'
                : selectedDate || selectedMonth !== 'all'
                  ? '1px solid rgba(6, 182, 212, 0.4)'
                  : '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: '0.3rem 0.55rem',
              fontSize: '0.76rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
            title={showCalendar ? 'Close date calendar' : 'Filter sessions by date'}
          >
            <Calendar size={13} />
            <span>{showCalendar ? 'Close' : (selectedDate ? new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Calendar')}</span>
          </button>
        </div>

        {/* Dedicated Active Date/Month Filter Bar */}
        {(selectedDate || selectedMonth !== 'all') && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(6, 182, 212, 0.08)',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              borderRadius: 6,
              padding: '0.3rem 0.6rem',
              fontSize: '0.74rem',
              color: '#38bdf8'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Calendar size={12} style={{ flexShrink: 0 }} />
              <strong>
                {selectedDate
                  ? new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : new Date(`${selectedMonth}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </strong>
              <span style={{ color: 'var(--text-muted)' }}>({filteredActivities.length})</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedDate(null);
                setSelectedMonth('all');
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.2rem',
                fontSize: '0.72rem',
                padding: '0.1rem 0.25rem',
                borderRadius: 4,
                flexShrink: 0
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              title="Show all sessions"
            >
              <span>All</span>
              <X size={11} />
            </button>
          </div>
        )}

        {/* Interactive Calendar Dropdown / Popover */}
        {showCalendar && (() => {
          const [viewYearStr, viewMonthStr] = calendarViewYm.split('-');
          const viewYear = parseInt(viewYearStr, 10);
          const viewMonth = parseInt(viewMonthStr, 10) - 1; // 0-indexed

          const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
          const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

          const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

          const handlePrevMonth = () => {
            const prev = new Date(viewYear, viewMonth - 1, 1);
            const py = prev.getFullYear();
            const pm = String(prev.getMonth() + 1).padStart(2, '0');
            setCalendarViewYm(`${py}-${pm}`);
          };

          const handleNextMonth = () => {
            const next = new Date(viewYear, viewMonth + 1, 1);
            const ny = next.getFullYear();
            const nm = String(next.getMonth() + 1).padStart(2, '0');
            setCalendarViewYm(`${ny}-${nm}`);
          };

          const handlePrevYear = () => {
            const py = viewYear - 1;
            const pm = String(viewMonth + 1).padStart(2, '0');
            setCalendarViewYm(`${py}-${pm}`);
          };

          const handleNextYear = () => {
            const ny = viewYear + 1;
            const nm = String(viewMonth + 1).padStart(2, '0');
            setCalendarViewYm(`${ny}-${nm}`);
          };

          const daysOfWeek = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

          return (
            <div
              className="calendar-popover"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 10,
                padding: '0.85rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem',
                boxShadow: 'var(--card-shadow)'
              }}
            >
              {/* Quick Year Selector Pills */}
              {availableYears.length > 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '0.25rem',
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)'
                  }}
                  role="group"
                  aria-label="Filter by year"
                >
                  {availableYears.map(yr => {
                    const count = activities.filter(a => a.start_time.startsWith(yr)).length;
                    const isCur = viewYear === parseInt(yr, 10);
                    return (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => {
                          const curMonth = calendarViewYm.split('-')[1] || '01';
                          setCalendarViewYm(`${yr}-${curMonth}`);
                        }}
                        style={{
                          flex: 1,
                          padding: '0.28rem 0.4rem',
                          borderRadius: 6,
                          border: isCur ? '1px solid var(--accent-cyan)' : '1px solid transparent',
                          background: isCur ? 'var(--accent-cyan)' : 'transparent',
                          color: isCur ? '#07090e' : 'var(--text-secondary)',
                          fontWeight: isCur ? 700 : 500,
                          fontSize: '0.74rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.3rem',
                          transition: 'all 0.15s ease'
                        }}
                        title={`Jump to ${yr} (${count} runs)`}
                      >
                        <span>{yr}</span>
                        <span style={{ fontSize: '0.66rem', opacity: isCur ? 0.9 : 0.6 }}>({count})</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Calendar Header with Navigation (Year & Month) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                  <button
                    type="button"
                    onClick={handlePrevYear}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '0.2rem',
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    title="Previous year (-1 year)"
                  >
                    <ChevronsLeft size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      padding: '0.2rem',
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    title="Previous month"
                  >
                    <ChevronLeft size={16} />
                  </button>
                </div>

                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)', userSelect: 'none' }}>
                  {monthLabel}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      padding: '0.2rem',
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    title="Next month"
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={handleNextYear}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '0.2rem',
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center'
                    }}
                    title="Next year (+1 year)"
                  >
                    <ChevronsRight size={16} />
                  </button>
                </div>
              </div>

              {/* Day of week headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', gap: '2px' }}>
                {daysOfWeek.map(d => (
                  <span key={d} style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    {d}
                  </span>
                ))}
              </div>

              {/* Calendar Days Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
                {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                  <div key={`empty-${i}`} style={{ height: 28 }} />
                ))}

                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const dayNum = i + 1;
                  const dayStr = String(dayNum).padStart(2, '0');
                  const fullDateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${dayStr}`;
                  const sessionEntry = activeDatesMap.get(fullDateStr);
                  const hasSession = Boolean(sessionEntry && sessionEntry.count > 0);
                  const isSelected = selectedDate === fullDateStr;

                  return (
                    <button
                      key={fullDateStr}
                      type="button"
                      disabled={!hasSession}
                      onClick={() => {
                        if (!hasSession) return;
                        setSelectedDate(fullDateStr);
                        setSelectedMonth('all'); // let date take precedence
                        // Auto-select the activity on this date if exists
                        if (sessionEntry && sessionEntry.ids.length > 0) {
                          onSelectActivity(sessionEntry.ids[0]);
                          setMobileSubTab('detail');
                        }
                      }}
                      style={{
                        position: 'relative',
                        height: 28,
                        borderRadius: 6,
                        border: isSelected
                          ? '1px solid var(--accent-cyan)'
                          : hasSession
                            ? '1px solid rgba(6, 182, 212, 0.3)'
                            : '1px solid transparent',
                        background: isSelected
                          ? 'var(--accent-cyan)'
                          : hasSession
                            ? 'rgba(6, 182, 212, 0.12)'
                            : 'transparent',
                        color: isSelected
                          ? '#07090e'
                          : hasSession
                            ? 'var(--text-primary)'
                            : 'var(--text-muted)',
                        fontSize: '0.72rem',
                        fontWeight: hasSession ? 700 : 400,
                        cursor: hasSession ? 'pointer' : 'default',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.12s ease',
                        opacity: hasSession ? 1 : 0.4
                      }}
                      title={hasSession ? `${fullDateStr}: ${sessionEntry?.count} run(s)` : `${fullDateStr}: No activity`}
                    >
                      <span>{dayNum}</span>
                      {hasSession && !isSelected && (
                        <span
                          style={{
                            position: 'absolute',
                            bottom: 2,
                            width: 4,
                            height: 4,
                            borderRadius: '50%',
                            background: sessionEntry && sessionEntry.runTypes.includes('intervals_vo2')
                              ? '#a855f7'
                              : sessionEntry && sessionEntry.runTypes.includes('threshold_lt2')
                                ? '#f59e0b'
                                : '#10b981'
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Quick Actions Footer */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid var(--border-subtle)', fontSize: '0.72rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  {(() => {
                    const monthRunCount = activities.filter(a => a.start_time.startsWith(calendarViewYm)).length;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMonth(calendarViewYm);
                          setSelectedDate(null);
                        }}
                        style={{
                          background: selectedMonth === calendarViewYm && !selectedDate ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 4,
                          color: selectedMonth === calendarViewYm && !selectedDate ? '#38bdf8' : 'var(--text-secondary)',
                          padding: '0.2rem 0.5rem',
                          cursor: 'pointer',
                          fontSize: '0.7rem',
                          fontWeight: 600
                        }}
                      >
                        All in {monthLabel.split(' ')[0]} ({monthRunCount})
                      </button>
                    );
                  })()}

                  {(selectedDate || selectedMonth !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDate(null);
                        setSelectedMonth('all');
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontSize: '0.7rem'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#f43f5e')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                    >
                      Show All Runs
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.66rem', color: 'var(--text-muted)', opacity: 0.85 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: '#10b981' }}>● Base</span>
                    <span style={{ color: '#f59e0b' }}>● Threshold</span>
                    <span style={{ color: '#a855f7' }}>● VO2 Max</span>
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Tag Filters Bar */}
        <div className="sidebar-filter-bar">
          {SIDEBAR_FILTER_TAGS.map(tag => {
            const count = tagCounts[tag] ?? 0;
            const isZero = count === 0 && selectedTagFilter.toLowerCase() !== tag.toLowerCase();
            return (
              <button
                key={tag}
                className={`sidebar-filter-chip ${selectedTagFilter.toLowerCase() === tag.toLowerCase() ? 'active' : ''} ${isZero ? 'filter-zero-count' : ''}`}
                onClick={() => setSelectedTagFilter(prev => {
                  if (tag.toLowerCase() === 'all') return 'all';
                  return prev.toLowerCase() === tag.toLowerCase() ? 'all' : tag;
                })}
              >
                {tag} <span className="sidebar-filter-count">({count})</span>
              </button>
            );
          })}
        </div>

        <div className="sessions-list">
          {groupedActivities.map(group => (
            <React.Fragment key={group.ym}>
              {selectedMonth === 'all' && group.title && (
                <div className="session-month-header">
                  <span>{group.title}</span>
                  <span className="session-month-badge">{group.items.length} runs • {group.totalKm} km</span>
                </div>
              )}
              {group.items.map(a => {
                const isSelected = a.id === selectedActivityId;
                const d = new Date(a.start_time);
                const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const distKm = (a.distance_meters / 1000).toFixed(2);
                const paceStr = formatPace(a.avg_pace_sec_km);
                const stars = scoreToStars(a.effectiveness_score);
                const isRace = a.run_type === 'race' ||
                  (a.tags && (a.tags.includes('Race') || a.tags.includes('race'))) ||
                  /time trial|race/i.test(a.name || '');

                let parsedTags: string[] = [];
                try {
                  parsedTags = a.tags ? JSON.parse(a.tags) : [];
                } catch {
                  parsedTags = [];
                }

                return (
                  <div
                    key={a.id}
                    className={`session-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setShowTagMenu(false);
                      onSelectActivity(a.id);
                      setMobileSubTab('detail');
                    }}
                  >
                    <div className="session-card-top">
                      <span className="session-date">{dateStr}</span>
                      <span className={`run-badge badge-${a.run_type || 'easy_base'}`}>
                        {(a.run_type || 'Easy').replace('_', ' ')}
                      </span>
                    </div>
                    {isRace && <div className="session-name">{getDisplayTitle(a)}</div>}
                    <div className="session-stats">
                      <span>{distKm} km</span>
                      <span>•</span>
                      <span>{paceStr}/km</span>
                      <span>•</span>
                      <span>{a.avg_heart_rate ?? '—'} bpm</span>
                    </div>
                    {parsedTags.length > 0 && (
                      <div className="session-card-tags">
                        {parsedTags.map(tag => (
                          <span
                            key={tag}
                            className={`session-tag-chip ${tag.toLowerCase() === 'strides' ? 'tag-strides' : ''}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {stars > 0 && (() => {
                      const tierLabel = stars === 3 ? 'gold' : stars === 2 ? 'silver' : 'bronze';
                      return (
                        <div className="session-card-footer">
                          <span
                            className={`execution-emblem emblem-${tierLabel}`}
                            title={`Execution: ${stars} / 3 Stars${a.effectiveness_score ? ` (${a.effectiveness_score}/100)` : ''}`}
                          >
                            {'★'.repeat(stars)}{'☆'.repeat(3 - stars)}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </React.Fragment>
          ))}

          {filteredActivities.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#64748b', fontSize: '0.85rem' }}>
              No runs matching selected filter.
            </div>
          )}
        </div>

        <div className="dropzone-inline" onClick={onOpenUpload}>
          + Drop or Import New Run CSV
        </div>
      </aside>

      {/* Right Main Panel: Run Details */}
      <main className="detail-panel">
        {activities.length === 0 ? (
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
              Ready for Your First Run
            </h3>
            <p style={{ maxWidth: 460, color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.55, margin: 0 }}>
              Your cardiovascular baselines are calibrated and ready. Import your Garmin <code>.fit</code> or <code>.csv</code> workout files to inspect your aerobic decoupling, running economy, and AI coach debriefs.
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
              <span>Import First Workout (.FIT / .CSV)</span>
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
            <section className="overview-card">
              <div className="overview-top">
                <div className="run-title-group">
                  {isEditingTitle ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                      <input
                        type="text"
                        value={customTitle}
                        onChange={e => setCustomTitle(e.target.value)}
                        placeholder="e.g. Standard Chartered Marathon"
                        style={{
                          background: '#172036',
                          color: '#fff',
                          border: '1px solid #06b6d4',
                          borderRadius: 6,
                          padding: '0.35rem 0.65rem',
                          fontSize: '1.2rem',
                          fontFamily: 'var(--font-heading)',
                          width: '320px'
                        }}
                      />
                      <button
                        onClick={async () => {
                          if (!act) return;
                          try {
                            const res = await fetch(`/api/activities/${act.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ name: customTitle })
                            });
                            if (res.ok) {
                              setDetailData(prev => prev ? { ...prev, activity: { ...prev.activity, name: customTitle } } : prev);
                              onActivityUpdated?.({ id: act.id, name: customTitle });
                              setIsEditingTitle(false);
                            }
                          } catch (err) {
                            console.error('Failed to update title:', err);
                          }
                        }}
                        style={{ background: '#06b6d4', color: '#07090e', border: 'none', borderRadius: 6, padding: '0.4rem 0.75rem', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setIsEditingTitle(false)}
                        style={{ background: 'transparent', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '0.4rem 0.75rem', cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                      <h1 style={{ margin: 0 }}>{getDisplayTitle(act)}</h1>
                      <button
                        onClick={() => { setCustomTitle(act.name); setIsEditingTitle(true); }}
                        title="Rename activity or name special race"
                        style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.2rem', display: 'flex', alignItems: 'center' }}
                      >
                        <Edit2 size={16} />
                      </button>
                    </div>
                  )}

                  <div className="run-meta-row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
                    <span>{new Date(act.start_time).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}</span>
                    <span>•</span>
                    <span>{new Date(act.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} ({getTimeOfDay(act.start_time)})</span>
                  </div>

                  {/* Dynamic Multi-Tags Row */}
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.65rem' }}>
                    <Tag size={13} color="#94a3b8" />
                    {currentTags.map(tag => (
                      <span
                        key={tag}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          background: 'rgba(6, 182, 212, 0.12)',
                          color: '#38bdf8',
                          border: '1px solid rgba(6, 182, 212, 0.3)',
                          padding: '0.15rem 0.5rem',
                          borderRadius: 999,
                          fontSize: '0.72rem',
                          fontWeight: 600
                        }}
                      >
                        {tag}
                        <X
                          size={11}
                          style={{ cursor: 'pointer', opacity: 0.7 }}
                          onClick={() => handleRemoveTag(tag)}
                        />
                      </span>
                    ))}

                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setShowTagMenu(!showTagMenu)}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px dashed rgba(255, 255, 255, 0.2)',
                          color: '#94a3b8',
                          padding: '0.15rem 0.5rem',
                          borderRadius: 999,
                          fontSize: '0.72rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.2rem'
                        }}
                      >
                        <Plus size={12} />
                        <span>Tag</span>
                      </button>

                      {showTagMenu && (
                        <div
                          ref={tagMenuRef}
                          style={{
                            position: 'absolute',
                            top: '120%',
                            left: 0,
                            zIndex: 30,
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 8,
                            padding: '0.6rem',
                            boxShadow: 'var(--card-shadow)',
                            width: '210px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.4rem'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.3rem', borderBottom: '1px solid var(--border-subtle)' }}>
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em' }}>Existing Tags</span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{currentTags.length} active</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxHeight: '230px', overflowY: 'auto' }}>
                            {COMMON_TAG_PRESETS.map(preset => {
                              const isApplied = currentTags.includes(preset);
                              return (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() => {
                                    if (isApplied) {
                                      handleRemoveTag(preset);
                                    } else {
                                      handleAddTag(preset);
                                    }
                                  }}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '0.35rem 0.55rem',
                                    borderRadius: 6,
                                    fontSize: '0.74rem',
                                    fontWeight: isApplied ? 600 : 400,
                                    background: isApplied ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                                    color: isApplied ? '#38bdf8' : 'var(--text-secondary)',
                                    border: isApplied ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    transition: 'all 0.15s ease'
                                  }}
                                >
                                  <span>{preset}</span>
                                  {isApplied ? <Check size={13} color="#38bdf8" /> : <Plus size={12} color="var(--text-muted)" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Weather & Microclimate Badge */}
                <div className="weather-chip-group">
                  {act.weather_temperature_c !== undefined && act.weather_temperature_c !== null ? (
                    <div
                      className="weather-chip weather-chip-ambient"
                      title={`Historical microclimate weather via Open-Meteo for workout GPS location (${act.workout_lat?.toFixed(3) ?? '—'}, ${act.workout_lon?.toFixed(3) ?? '—'}). Fetched: ${act.weather_fetched_at || 'Recently'}`}
                    >
                      <CloudRain size={14} style={{ color: '#38bdf8' }} />
                      <span className="weather-temp-main">{act.weather_temperature_c}°C</span>
                      {act.weather_condition && (
                        <span className="weather-cond">{act.weather_condition}</span>
                      )}
                      {act.weather_humidity_pct !== null && (
                        <span className="weather-metric" title="Relative Humidity">
                          <Droplets size={11} /> {act.weather_humidity_pct}%
                        </span>
                      )}
                      {act.weather_apparent_temp_c !== null && (
                        <span className="weather-metric" title="Apparent Temperature (Feels like)">
                          Feels {act.weather_apparent_temp_c}°C
                        </span>
                      )}
                      {act.avg_temperature && (
                        <span className="weather-watch-sensor" title="On-wrist Garmin optical/device sensor (elevated by skin heat)">
                          Watch: {act.avg_temperature}°C
                        </span>
                      )}
                      <button
                        className="weather-refresh-btn"
                        onClick={handleRefreshWeather}
                        disabled={isRefreshingWeather}
                        title="Re-fetch microclimate weather from Open-Meteo"
                        aria-label="Refresh weather"
                      >
                        <RefreshCw size={12} className={isRefreshingWeather ? 'spinning' : ''} />
                      </button>
                    </div>
                  ) : act.workout_lat && act.workout_lon ? (
                    <div className="weather-chip weather-chip-ambient">
                      <Cloud size={14} style={{ color: '#38bdf8' }} />
                      <span>Microclimate weather available</span>
                      <button
                        className="weather-fetch-btn"
                        onClick={handleRefreshWeather}
                        disabled={isRefreshingWeather}
                      >
                        <RefreshCw size={12} className={isRefreshingWeather ? 'spinning' : ''} />
                        {isRefreshingWeather ? 'Fetching...' : 'Fetch Weather'}
                      </button>
                    </div>
                  ) : act.avg_temperature ? (
                    <div className="weather-chip">
                      <Thermometer size={14} />
                      <span>Garmin Sensor: {act.avg_temperature}°C</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Metric chips */}
              <div className="metric-chips-grid">
                <div className="metric-chip">
                  <span className="metric-chip-label">Distance</span>
                  <span className="metric-chip-value">{(act.distance_meters / 1000).toFixed(2)}<span className="metric-chip-unit">km</span></span>
                </div>
                <div className="metric-chip">
                  <span className="metric-chip-label">Moving Time</span>
                  <span className="metric-chip-value">{formatTime(act.duration_seconds)}</span>
                </div>
                <div className="metric-chip">
                  <span className="metric-chip-label">
                    Avg Pace {act.steady_pace_sec_km && act.steady_pace_sec_km !== act.avg_pace_sec_km ? '(Steady)' : ''}
                  </span>
                  <span className="metric-chip-value" style={{ color: '#06b6d4' }}>
                    {formatPace(act.steady_pace_sec_km || act.avg_pace_sec_km)}
                    <span className="metric-chip-unit">/km</span>
                  </span>
                  {act.steady_pace_sec_km && act.steady_pace_sec_km !== act.avg_pace_sec_km && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      Raw: {formatPace(act.avg_pace_sec_km)}
                    </span>
                  )}
                </div>
                <div className="metric-chip">
                  <span className="metric-chip-label">
                    {act.steady_heart_rate && act.steady_heart_rate !== act.avg_heart_rate ? 'Steady-State HR' : 'Avg Heart Rate'}
                  </span>
                  <span className="metric-chip-value" style={{ color: '#f59e0b' }}>
                    {act.steady_heart_rate || act.avg_heart_rate || '—'}
                    <span className="metric-chip-unit">bpm</span>
                  </span>
                  {act.steady_heart_rate && act.steady_heart_rate !== act.avg_heart_rate && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      Raw (incl. breaks): {act.avg_heart_rate}
                    </span>
                  )}
                </div>
                <div className="metric-chip">
                  <span className="metric-chip-label">Max HR</span>
                  <span className="metric-chip-value">{act.max_heart_rate ?? '—'}<span className="metric-chip-unit">bpm</span></span>
                </div>
                <div className="metric-chip">
                  <span className="metric-chip-label">
                    Cadence {act.steady_cadence && act.steady_cadence !== act.avg_cadence ? '(Steady)' : ''}
                  </span>
                  <span className="metric-chip-value">
                    {act.steady_cadence || act.avg_cadence || '—'}
                    <span className="metric-chip-unit">spm</span>
                  </span>
                  {act.steady_cadence && act.steady_cadence !== act.avg_cadence && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                      Raw: {act.avg_cadence} spm
                    </span>
                  )}
                </div>
                <div className="metric-chip">
                  <span className="metric-chip-label">Elevation Gain</span>
                  <span className="metric-chip-value">+{act.elevation_gain_m ? Math.round(act.elevation_gain_m) : 0}<span className="metric-chip-unit">m</span></span>
                </div>
                <div className="metric-chip">
                  <span className="metric-chip-label">Calories</span>
                  <span className="metric-chip-value">{act.calories ?? '—'}<span className="metric-chip-unit">kcal</span></span>
                </div>
              </div>

              {/* Steady State & Pause/Walk Isolation Banner */}
              {((act.pause_duration_seconds ?? 0) > 0 || (act.walk_duration_seconds ?? 0) > 0) && (
                <div
                  className="pause-isolation-banner"
                  style={{
                    marginTop: '1rem',
                    padding: '0.75rem 1rem',
                    background: 'rgba(6, 182, 212, 0.08)',
                    border: '1px solid rgba(6, 182, 212, 0.22)',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <ShieldCheck size={16} color="#06b6d4" />
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                      <strong style={{ color: '#06b6d4' }}>Steady-State Running Isolated:</strong>{' '}
                      {act.steady_pace_sec_km ? `${formatPace(act.steady_pace_sec_km)}/km pace` : ''}
                      {act.steady_cadence ? ` • ${act.steady_cadence} spm cadence` : ''}
                      {act.steady_heart_rate ? ` • ${act.steady_heart_rate} bpm HR` : ''}
                      {act.steady_stance_time ? ` • ${Math.round(act.steady_stance_time)} ms GCT` : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Excludes {act.pause_duration_seconds ? `${formatTime(act.pause_duration_seconds)} traffic stops` : ''}
                    {act.pause_duration_seconds && act.walk_duration_seconds ? ' & ' : ''}
                    {act.walk_duration_seconds ? `${formatTime(act.walk_duration_seconds)} walk breaks (${Math.round(act.walk_distance_meters || 0)}m)` : ''}
                  </div>
                </div>
              )}
            </section>

            {/* Sub-Tabs Selector for Main Panel */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
              <button
                id="subtab-telemetry-btn"
                className={`filter-pill-btn ${activeSubTab === 'telemetry' ? 'active' : ''}`}
                onClick={() => setActiveSubTab('telemetry')}
              >
                Telemetry & Chart
              </button>
              {(detailData.splits?.length ?? 0) > 0 && (
                <button
                  id="subtab-splits-btn"
                  className={`filter-pill-btn ${activeSubTab === 'splits' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('splits')}
                >
                  KM Splits ({detailData.splits.length})
                </button>
              )}
              {(intervalsTabVisible) && (
                <button
                  id="subtab-strides-btn"
                  className={`filter-pill-btn ${activeSubTab === 'strides' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('strides')}
                >
                  Strides & Intervals ({detailData.intervals.length})
                </button>
              )}
              <button
                id="subtab-notes-btn"
                className={`filter-pill-btn ${activeSubTab === 'notes' ? 'active' : ''}`}
                onClick={() => setActiveSubTab('notes')}
              >
                Notes & AI Coach
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
                      {focusCoreSegment ? '✓ Core Segment Focused (Warmup Trimmed)' : 'Focus Core Segment (Exclude Warmup)'}
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
                      <span className="goal-card-title">Aerobic Decoupling (Pa:Hr)</span>
                      <HeartPulse size={18} color="#06b6d4" />
                    </div>
                    <div className="goal-stat-highlight" style={{ color: (act.aerobic_decoupling_pct ?? 0) < 4.5 ? '#10b981' : '#f59e0b' }}>
                      {act.aerobic_decoupling_pct !== null ? `${act.aerobic_decoupling_pct.toFixed(1)}%` : '—'}
                    </div>
                    <p className="goal-stat-desc">
                      {(act.aerobic_decoupling_pct ?? 0) < 4.5
                        ? 'Solid aerobic base. Cardiac drift stayed below the 4.5% LT1 threshold.'
                        : 'Cardiac drift detected. Heart rate drifted higher relative to pace.'}
                    </p>
                  </div>

                  <div className="goal-card">
                    <div className="goal-card-header">
                      <span className="goal-card-title">Running Economy (EF)</span>
                      <Zap size={18} color="#10b981" />
                    </div>
                    <div className="goal-stat-highlight" style={{ color: '#10b981' }}>
                      {act.efficiency_factor ? `${act.efficiency_factor.toFixed(2)}` : '—'}
                      <span style={{ fontSize: '0.85rem', color: '#94a3b8', marginLeft: '0.3rem' }}>m/min per bpm</span>
                    </div>
                    <p className="goal-stat-desc">
                      {act.meters_per_beat ? `${act.meters_per_beat.toFixed(2)} meters per heartbeat.` : 'Speed output per cardiovascular stroke.'}
                    </p>
                  </div>

                  <div className="goal-card">
                    <div className="goal-card-header">
                      <span className="goal-card-title">Biomechanical Dynamics</span>
                      <Compass size={18} color="#8b5cf6" />
                    </div>
                    <div className="goal-stat-highlight" style={{ color: '#8b5cf6', fontSize: '1.4rem' }}>
                      {act.avg_stance_time ? `${Math.round(act.avg_stance_time)} ms` : '—'}
                      <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginLeft: '0.5rem' }}>
                        GCT • {act.avg_vertical_oscillation ? `${(act.avg_vertical_oscillation / 10).toFixed(1)} cm Osc` : ''}
                      </span>
                    </div>
                    <p className="goal-stat-desc">
                      Reflects leg spring stiffness and vertical energy conservation.
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
                compact={false}
              />
            )}

            {/* SUBTAB 2: Strides & Intervals */}
            {activeSubTab === 'strides' && intervalsTabVisible && (() => {
              const allIntervals = detailData.intervals || [];
              const workIntervals = allIntervals.filter((i: any) => i.type === 'work' || i.type === 'stride');
              const displayedIntervals = intervalFilter === 'work_only' && workIntervals.length > 0
                ? workIntervals
                : allIntervals;

              // For easy / long / recovery runs the whole run is steady work,
              // so detected work segments read as steady state, not quality reps.
              const isQualityRun = detailData?.activity?.run_type === 'threshold_lt2' ||
                detailData?.activity?.run_type === 'intervals_vo2' ||
                detailData?.activity?.run_type === 'race';

              // Prescription inference (display only): median work/recovery snapped to
              // canonical rounded durations. Mirrors backend inferWorkoutPrescription.
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
              // Between-work gaps only: leading warmup / trailing cooldown
              // recoveries would skew the recovery median.
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

                    {/* Filter Toggle: Work Reps Only vs All Segments */}
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

                            // Find recovery drop after this rep
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
            })()}

            {/* SUBTAB 3: Notes & AI Coach */}
            {activeSubTab === 'notes' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* AI / Coach Summary & Effectiveness */}
                {detailData.coachSummary && (() => {
                  const rawStars = detailData.coachSummary.stars ?? scoreToStars(detailData.coachSummary.effectivenessScore ?? detailData.coachSummary.rating5);
                  const coachStars = Math.max(1, Math.min(3, rawStars > 3 ? (rawStars >= 4 ? 3 : 2) : (rawStars || 1)));
                  const effScore = detailData.coachSummary.effectivenessScore;
                  return (
                    <section className="coach-summary-card">
                      <div className="coach-header">
                        <div className="coach-title-group">
                          <span className="coach-tag">Coach AI</span>
                          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {detailData.coachSummary.headline}
                          </h3>
                        </div>
                        <button
                          type="button"
                          className="coach-score-badge"
                          onClick={() => setShowScoreBreakdown(prev => !prev)}
                          title="Click to toggle full execution score breakdown & grading rubric"
                          style={{ cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                        >
                          <ShieldCheck size={16} />
                          {(() => {
                            const tierLabel = coachStars === 3 ? 'gold' : coachStars === 2 ? 'silver' : 'bronze';
                            return (
                              <span className={`execution-emblem emblem-${tierLabel}`} style={{ fontSize: '0.85rem', padding: '0.2rem 0.55rem' }}>
                                {'★'.repeat(coachStars)}{'☆'.repeat(Math.max(0, 3 - coachStars))}
                                {effScore ? <span style={{ opacity: 0.75, marginLeft: '0.4rem', fontWeight: 600, fontSize: '0.78rem' }}>{effScore}/100</span> : null}
                              </span>
                            );
                          })()}
                          <ChevronDown
                            size={14}
                            style={{
                              marginLeft: '4px',
                              transform: showScoreBreakdown ? 'rotate(180deg)' : 'none',
                              transition: 'transform 0.2s ease',
                              opacity: 0.6
                            }}
                          />
                        </button>
                      </div>

                      {/* Transparent Execution Score Breakdown & Rubric */}
                      {showScoreBreakdown && (
                        <div className="score-breakdown-card">
                          <div className="score-breakdown-header">
                            <span className="score-breakdown-title">Physiological Execution Score Breakdown</span>
                            <span className="score-breakdown-total">
                              Final Execution: <b>{effScore ?? '—'} / 100</b>
                              {' · '}
                              {coachStars === 3 ? '★★★ Gold' : coachStars === 2 ? '★★☆ Silver' : '★☆☆ Bronze'}
                            </span>
                          </div>

                          <div className="score-breakdown-factors">
                            {(detailData.coachSummary.scoreBreakdown || []).map((factor: any, fIdx: number) => {
                              const isPos = factor.points > 0;
                              const isNeg = factor.points < 0;
                              return (
                                <div key={fIdx} className="score-factor-row">
                                  <div className="score-factor-main">
                                    <span className="score-factor-cat">{factor.category}</span>
                                    <span className="score-factor-label">{factor.label}</span>
                                    {factor.description && (
                                      <span className="score-factor-desc">{factor.description}</span>
                                    )}
                                  </div>
                                  <span className={`score-factor-points ${isPos ? 'points-positive' : (isNeg ? 'points-negative' : 'points-neutral')}`}>
                                    {isPos ? `+${factor.points}` : factor.points}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {/* Physiological Grading Rubric (3-tier) */}
                          <div className="score-rubric-legend">
                            <span className="rubric-legend-title">Grading Tiers</span>
                            <div className="rubric-tiers">
                              <span className={coachStars === 3 ? 'rubric-active' : ''}>
                                <b>★★★ Gold (85–100):</b> Near-perfect execution — stable HR, optimal cadence, tight pacing
                              </span>
                              <span className={coachStars === 2 ? 'rubric-active' : ''}>
                                <b>★★☆ Silver (70–84):</b> Solid stimulus — productive aerobic work with minor drift or variance
                              </span>
                              <span className={coachStars === 1 ? 'rubric-active' : ''}>
                                <b>★☆☆ Bronze (&lt;70):</b> Compromised — accidental tempo, heavy drift, aborted workout
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      <ul className="coach-insights-list">
                        {(detailData.coachSummary.keyInsights || []).map((insight: string, idx: number) => (
                          <li key={idx} className="coach-insight-item">
                            <span className="coach-insight-bullet">◆</span>
                            <span>{insight}</span>
                          </li>
                        ))}
                      </ul>

                      <div className="coach-recommendation">
                        <strong style={{ color: '#06b6d4' }}>Next Step: </strong>
                        {detailData.coachSummary.recommendation}
                      </div>
                    </section>
                  );
                })()}

                {/* Extended Notes Field */}
                <section className="data-table-card">
                  <div className="sidebar-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <FileText size={16} color="#06b6d4" />
                      <span className="sidebar-title">Runner Notes & Observations</span>
                    </div>
                    {notesSaveStatus && (
                      <span style={{ color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>{notesSaveStatus}</span>
                    )}
                  </div>

                  <textarea
                    rows={4}
                    value={runnerNotes}
                    onChange={e => setRunnerNotes(e.target.value)}
                    placeholder="Log how you felt, shoe choice, route obstacles, hill/ramp walks, or weather anomalies..."
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
                      Clear
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
                      {isSavingNotes ? 'Saving...' : 'Save Notes'}
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
