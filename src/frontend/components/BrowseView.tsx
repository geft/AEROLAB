import React, { useState, useEffect } from 'react';
import { Calendar, CloudRain, Flame, TrendingUp, Zap, Clock, ShieldCheck, HeartPulse, Compass, Edit2, Tag, Plus, X, FileText, Activity as ActivityIcon, Droplets, RefreshCw, Thermometer, Sun, Cloud, ChevronDown, HelpCircle } from 'lucide-react';
import { CanvasRunChart } from './CanvasRunChart';
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
  if (score <= 5) return Math.min(5, Math.max(1, Math.round(score)));
  if (score >= 90) return 5;
  if (score >= 78) return 4;
  if (score >= 65) return 3;
  if (score >= 50) return 2;
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
  if (lower === 'failed workout' && a.run_type === 'failed_workout') return true;
  if (lower === 'tempo' && a.run_type === 'tempo') return true;
  if (lower === 'marathon pace' && tagsArr.some(t => t.toLowerCase().includes('marathon'))) return true;
  if (lower === 'strides' && (a.run_type === 'strides' || tagsArr.some(t => t.toLowerCase().includes('stride')))) return true;
  return false;
}

const COMMON_TAG_PRESETS = [
  'Easy Base', 'Long Run', 'Recovery', 'Threshold', 'VO2 Max',
  'Tempo', 'Marathon Pace', 'Strides', 'Race', 'Failed Workout'
];

const SIDEBAR_FILTER_TAGS = [
  'All', 'Threshold', 'VO2 Max', 'Easy Base', 'Long Run', 'Race', 'Strides', 'Marathon Pace', 'Recovery', 'Failed Workout'
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
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('all');
  const [focusCoreSegment, setFocusCoreSegment] = useState<boolean>(false);
  const [activeSubTab, setActiveSubTab] = useState<'telemetry' | 'strides' | 'notes'>('telemetry');
  const [intervalFilter, setIntervalFilter] = useState<'work_only' | 'all'>('work_only');
  const [isEditingTitle, setIsEditingTitle] = useState<boolean>(false);
  const [customTitle, setCustomTitle] = useState<string>('');
  const [newTagInput, setNewTagInput] = useState<string>('');
  const [showTagMenu, setShowTagMenu] = useState<boolean>(false);
  const tagMenuRef = React.useRef<HTMLDivElement>(null);
  const [runnerNotes, setRunnerNotes] = useState<string>('');
  const [isSavingNotes, setIsSavingNotes] = useState<boolean>(false);
  const [notesSaveStatus, setNotesSaveStatus] = useState<string | null>(null);

  const [showScoreBreakdown, setShowScoreBreakdown] = useState<boolean>(false);

  // Auto-dismiss tag menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(event.target as Node)) {
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

  // Derive unique year-months from activities
  const monthOptions = React.useMemo(() => {
    const set = new Set<string>();
    activities.forEach(a => {
      const ym = a.start_time.substring(0, 7);
      if (ym) set.add(ym);
    });
    return Array.from(set).sort().reverse();
  }, [activities]);

  const filteredActivities = React.useMemo(() => {
    return activities.filter(a => {
      // Month filter
      if (selectedMonth !== 'all' && !a.start_time.startsWith(selectedMonth)) {
        return false;
      }
      // Tag filter
      return doesActivityMatchTag(a, selectedTagFilter);
    });
  }, [activities, selectedMonth, selectedTagFilter]);

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

  useEffect(() => {
    if (!selectedActivityId) {
      if (activities.length > 0) {
        onSelectActivity(activities[0].id);
      }
      return;
    }

    setLoadingDetail(true);
    fetch(`/api/activities/${selectedActivityId}`)
      .then(res => res.json())
      .then(data => {
        setDetailData(data);
        setRunnerNotes(data.activity?.notes || '');
        if (!data.intervals || data.intervals.length === 0) {
          setActiveSubTab(prev => (prev === 'strides' ? 'telemetry' : prev));
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
        setLoadingDetail(false);
      })
      .catch(err => {
        console.error('Failed to load activity detail:', err);
        setLoadingDetail(false);
      });
  }, [selectedActivityId, activities]);

  const act = detailData?.activity;

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
    const updated = [...currentTags, trimmed];
    handleUpdateTags(updated);
    setNewTagInput('');
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
    <div className="browse-grid">
      {/* Left Sidebar: Sessions List & Month Picker */}
      <aside className="sidebar-panel">
        <div className="sidebar-header">
          <span className="sidebar-title">Sessions ({filteredActivities.length})</span>
          <select
            className="month-picker-select"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          >
            <option value="all">All Months</option>
            {monthOptions.map(ym => {
              const count = activities.filter(a => a.start_time.startsWith(ym)).length;
              const dateObj = new Date(`${ym}-01`);
              const label = dateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
              return (
                <option key={ym} value={ym}>
                  {label} ({count})
                </option>
              );
            })}
          </select>
        </div>

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
                const dateStr = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
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
                // Ensure runs with strides include 'Strides' tag
                if (!parsedTags.some(t => t.toLowerCase() === 'strides')) {
                  if (a.run_type === 'strides' || /stride/i.test(a.name || '')) {
                    parsedTags.push('Strides');
                  }
                }

                return (
                  <div
                    key={a.id}
                    className={`session-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setShowTagMenu(false);
                      onSelectActivity(a.id);
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
                    {stars > 0 && (
                      <div className="session-card-footer">
                        <span className="session-rating-pill" title={`Execution: ${stars} / 5 Stars${a.effectiveness_score ? ` (${a.effectiveness_score}/100)` : ''}`}>
                          <span className="stars-filled">{'★'.repeat(stars)}</span>
                          {stars < 5 && <span className="stars-empty">{'★'.repeat(5 - stars)}</span>}
                        </span>
                      </div>
                    )}
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
        {loadingDetail || !act ? (
          <div className="overview-card loading-skeleton" style={{ height: 350 }}></div>
        ) : (
          <>
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
                            padding: '0.75rem',
                            boxShadow: 'var(--card-shadow)',
                            width: '240px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.5rem'
                          }}
                        >
                          <input
                            type="text"
                            placeholder="Type tag & enter..."
                            value={newTagInput}
                            onChange={e => setNewTagInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                handleAddTag(newTagInput);
                              }
                            }}
                            style={{
                              background: 'var(--bg-surface)',
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)',
                              borderRadius: 4,
                              padding: '0.3rem 0.5rem',
                              fontSize: '0.75rem'
                            }}
                          />
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Presets</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                            {COMMON_TAG_PRESETS.map(preset => (
                              <span
                                key={preset}
                                onClick={() => handleAddTag(preset)}
                                style={{
                                  background: 'var(--tag-pill-bg)',
                                  border: '1px solid var(--border-subtle)',
                                  padding: '0.15rem 0.4rem',
                                  borderRadius: 4,
                                  fontSize: '0.7rem',
                                  color: 'var(--text-secondary)',
                                  cursor: 'pointer'
                                }}
                              >
                                {preset}
                              </span>
                            ))}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
              <button
                className={`filter-pill-btn ${activeSubTab === 'telemetry' ? 'active' : ''}`}
                onClick={() => setActiveSubTab('telemetry')}
              >
                Telemetry & Chart
              </button>
              {(detailData.intervals?.length ?? 0) > 0 && (
                <button
                  className={`filter-pill-btn ${activeSubTab === 'strides' ? 'active' : ''}`}
                  onClick={() => setActiveSubTab('strides')}
                >
                  Strides & Intervals ({detailData.intervals.length})
                </button>
              )}
              <button
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

                {/* Kilometer Splits Table */}
                {detailData.splits && detailData.splits.length > 0 && (
                  <section className="data-table-card">
                    <div className="sidebar-header">
                      <span className="sidebar-title">Kilometer Splits</span>
                    </div>
                    <div className="table-wrapper">
                      <table className="styled-table">
                        <thead>
                          <tr>
                            <th>Km</th>
                            <th>Split Pace</th>
                            <th>Time</th>
                            <th>Avg HR</th>
                            <th>Split EF</th>
                            <th>Elev Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.splits.map((s: any) => (
                            <tr key={s.id}>
                              <td><b>Km {s.split_index}</b></td>
                              <td style={{ color: '#06b6d4', fontWeight: 600 }}>{formatPace(s.avg_pace_sec_km)}/km</td>
                              <td>{formatTime(s.duration_seconds)}</td>
                              <td>{s.avg_heart_rate} bpm</td>
                              <td>{s.split_efficiency_factor ? s.split_efficiency_factor.toFixed(2) : '—'}</td>
                              <td>{s.elevation_change_m > 0 ? `+${s.elevation_change_m}m` : `${s.elevation_change_m}m`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </>
            )}

            {/* SUBTAB 2: Strides & Intervals */}
            {activeSubTab === 'strides' && (() => {
              const allIntervals = detailData.intervals || [];
              const workIntervals = allIntervals.filter((i: any) => i.type === 'work' || i.type === 'stride');
              const displayedIntervals = intervalFilter === 'work_only' && workIntervals.length > 0
                ? workIntervals
                : allIntervals;

              return (
                <section className="data-table-card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span className="sidebar-title">
                        {intervalFilter === 'work_only' ? `Interval Work Reps (${workIntervals.length})` : `All Segments & Recoveries (${allIntervals.length})`}
                      </span>
                      <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
                        Strides isolate explosive neuromuscular turnover. Work reps emphasize Peak Heart Rate (since interval HR has a 60–90s ramp-up lag) and subsequent Recovery HR Drop.
                      </p>
                    </div>

                    {/* Filter Toggle: Work Reps Only vs All Segments */}
                    {allIntervals.length > 0 && (
                      <div className="filter-pills" style={{ marginTop: 0 }}>
                        <button
                          className={`filter-pill-btn ${intervalFilter === 'work_only' ? 'active' : ''}`}
                          onClick={() => setIntervalFilter('work_only')}
                        >
                          Work Reps Only ({workIntervals.length})
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
                      <table className="styled-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Segment Type</th>
                            <th>Duration</th>
                            <th>Distance</th>
                            <th>Pace (Avg / Peak)</th>
                            <th title="Peak HR is the true cardiovascular stimulus reached; Avg HR is physiologically lagged during interval accelerations.">
                              HR (Peak / Avg)
                            </th>
                            <th>Cadence • Dynamics</th>
                            <th>Recovery Drop</th>
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

                            const typeLabel = isWarmup ? 'Warmup' : (isCooldown ? 'Cooldown' : inv.type);
                            const badgeClass = inv.type === 'stride'
                              ? 'badge-intervals_vo2'
                              : (inv.type === 'work' ? 'badge-threshold_lt2' : 'badge-easy_base');

                            return (
                              <tr key={inv.id}>
                                <td><b>{inv.interval_index}</b></td>
                                <td>
                                  <span className={`run-badge ${badgeClass}`}>
                                    {typeLabel}
                                  </span>
                                </td>
                                <td>{formatTime(inv.duration_seconds)}</td>
                                <td>
                                  {inv.distance_meters >= 1000
                                    ? `${(inv.distance_meters / 1000).toFixed(2)} km`
                                    : `${Math.round(inv.distance_meters)}m`}
                                </td>
                                <td>
                                  <span style={{ color: '#06b6d4', fontWeight: 600 }}>{formatPace(inv.avg_pace_sec_km)}/km</span>
                                  {inv.peak_pace_sec_km && inv.peak_pace_sec_km < inv.avg_pace_sec_km && (
                                    <span style={{ fontSize: '0.75rem', color: '#38bdf8', marginLeft: '0.35rem' }}>
                                      (Peak {formatPace(inv.peak_pace_sec_km)})
                                    </span>
                                  )}
                                </td>
                                <td>
                                  {inv.type === 'work' || inv.type === 'stride' ? (
                                    <div>
                                      <span style={{ fontWeight: 700, color: '#f59e0b' }}>
                                        {inv.max_heart_rate} bpm Peak
                                      </span>
                                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.35rem' }}>
                                        (avg {inv.avg_heart_rate})
                                      </span>
                                    </div>
                                  ) : (
                                    <span>{inv.avg_heart_rate} bpm</span>
                                  )}
                                </td>
                                <td>
                                  {inv.peak_cadence ? (
                                    <span style={{ fontSize: '0.8rem', color: '#e2e8f0' }}>
                                      <b>{inv.peak_cadence}</b> spm
                                      {inv.min_stance_time ? ` • ${Math.round(inv.min_stance_time)} ms GCT` : ''}
                                    </span>
                                  ) : (
                                    `${inv.avg_cadence} spm`
                                  )}
                                </td>
                                <td>
                                  {effectiveDrop ? (
                                    <span style={{ color: '#10b981', fontWeight: 600 }}>
                                      -{effectiveDrop} bpm
                                      {nextSegment && nextSegment.type === 'recovery' && inv.type === 'work' && (
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>
                                          ({formatTime(nextSegment.duration_seconds)})
                                        </span>
                                      )}
                                    </span>
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
                  const coachStars = detailData.coachSummary.stars ?? scoreToStars(detailData.coachSummary.effectivenessScore ?? detailData.coachSummary.rating5);
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
                          style={{ cursor: 'pointer', background: 'transparent', font: 'inherit' }}
                        >
                          <ShieldCheck size={16} />
                          <span className="coach-star-rating" style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                            <span style={{ color: '#f59e0b', letterSpacing: '1px' }}>{'★'.repeat(coachStars)}</span>
                            {coachStars < 5 && (
                              <span style={{ color: 'rgba(245, 158, 11, 0.25)', letterSpacing: '1px' }}>
                                {'★'.repeat(5 - coachStars)}
                              </span>
                            )}
                          </span>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginLeft: '0.25rem' }}>
                            ({coachStars} / 5 Stars){effScore ? ` • ${effScore}/100` : ''}
                          </span>
                          <ChevronDown
                            size={14}
                            style={{
                              marginLeft: '2px',
                              transform: showScoreBreakdown ? 'rotate(180deg)' : 'none',
                              transition: 'transform 0.2s ease',
                              opacity: 0.8
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
                              Final Execution: <b>{effScore ?? Math.round(coachStars * 20)} / 100</b> ({coachStars} / 5 Stars)
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

                          {/* Physiological Grading Rubric */}
                          <div className="score-rubric-legend">
                            <span className="rubric-legend-title">Grading Rubric & Standards</span>
                            <div className="rubric-tiers">
                              <span className={coachStars === 5 ? 'rubric-active' : ''}>
                                ★★★★★ (90–100): Near-perfect physiological execution & pacing adherence
                              </span>
                              <span className={coachStars === 4 ? 'rubric-active' : ''}>
                                ★★★★☆ (78–89): Solid stimulus; minor drift (&lt;6%) or slight cadence variance
                              </span>
                              <span className={coachStars === 3 ? 'rubric-active' : ''}>
                                ★★★☆☆ (65–77): Productive session; compromised by thermal drift, high variance, or accidental grey-zone creep
                              </span>
                              <span className={coachStars === 2 ? 'rubric-active' : ''}>
                                ★★☆☆☆ (50–64): Aborted interval set, early cutoff, or pace collapse
                              </span>
                              <span className={coachStars === 1 ? 'rubric-active' : ''}>
                                ★☆☆☆☆ (&lt;50): Severe pacing failure or injury stoppage
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      <ul className="coach-insights-list">
                        {detailData.coachSummary.keyInsights.map((insight: string, idx: number) => (
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
