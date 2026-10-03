import { SessionVerdictBadge } from './SessionVerdictBadge.js';
import React from 'react';

import type { DisplayTitleFn } from '../../features/browse/selectors.js';
import type { Translations } from '../../i18n/types.js';
import { Calendar, X } from 'lucide-react';
import { BrowseCalendarPicker } from './BrowseCalendarPicker';
import { translateTag } from '../../i18n/tagTranslator';
import { useTranslation } from '../../i18n/LanguageContext';
import { ActivitySummary } from '../../features/browse/selectors.js';

const SIDEBAR_FILTER_TAGS = [
  'All', 'Threshold', 'VO2 Max', 'Easy Base', 'Long Run', 'Race', 'Strides', 'Marathon Pace', 'Recovery'
];


interface BrowseSidebarProps {
  filteredActivities: ActivitySummary[];
  groupedActivities: Array<{ ym: string; title: string; items: ActivitySummary[]; totalKm: number }>;
  tagCounts: Record<string, number>;
  selectedTagFilter: string;
  setSelectedTagFilter: React.Dispatch<React.SetStateAction<string>>;
  selectedActivityId: string | null;
  onSelectActivity: (id: string) => void;
  selectedDate: string | null;
  setSelectedDate: (d: string | null) => void;
  selectedMonth: string;
  setSelectedMonth: (m: string) => void;
  showCalendar: boolean;
  setShowCalendar: React.Dispatch<React.SetStateAction<boolean>>;
  calendarViewYm: string;
  setCalendarViewYm: React.Dispatch<React.SetStateAction<string>>;
  availableYears: string[];
  activeDatesMap: Map<string, { count: number; runTypes: string[]; ids: string[] }>;
  setMobileSubTab: (tab: 'list' | 'detail') => void;
  setShowTagMenu: (show: boolean) => void;
  onOpenUpload: () => void;
  readOnly?: boolean;
  getDisplayTitle: DisplayTitleFn;
  formatPace: (secKm: number | null) => string;
  language: 'en' | 'zh';
  t: Translations;
  activitiesCount: number;
}

export const BrowseSidebar: React.FC<BrowseSidebarProps> = ({
  filteredActivities,
  groupedActivities,
  tagCounts,
  selectedTagFilter,
  setSelectedTagFilter,
  selectedActivityId,
  onSelectActivity,
  selectedDate,
  setSelectedDate,
  selectedMonth,
  setSelectedMonth,
  showCalendar,
  setShowCalendar,
  calendarViewYm,
  setCalendarViewYm,
  availableYears,
  activeDatesMap,
  setMobileSubTab,
  setShowTagMenu,
  onOpenUpload,
  readOnly = false,
  getDisplayTitle,
  formatPace,
  language,
  t,
  activitiesCount
}) => {
  const { formatDate, format } = useTranslation();

  // A calendar day can hold more than one run (a morning base run plus an
  // evening threshold session). The date label alone cannot tell those apart,
  // so order them explicitly within the day: run 1 is the earliest one.
  const sameDayRunInfo = React.useMemo(() => {
    const byDay = new Map<string, ActivitySummary[]>();
    groupedActivities.forEach(group => {
      group.items.forEach(a => {
        const day = a.start_time?.substring(0, 10);
        if (!day) return;
        const list = byDay.get(day);
        if (list) list.push(a);
        else byDay.set(day, [a]);
      });
    });

    const info = new Map<string, { index: number; total: number }>();
    byDay.forEach(list => {
      if (list.length < 2) return;
      list
        .slice()
        .sort((x, y) => (x.start_time || '').localeCompare(y.start_time || ''))
        .forEach((a, i) => info.set(a.id, { index: i + 1, total: list.length }));
    });
    return info;
  }, [groupedActivities]);

  return (
    <aside className="sidebar-panel">
      <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', minWidth: 0 }}>
          <span className="sidebar-title" style={{ whiteSpace: 'nowrap' }}>{t.browse.title}</span>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            ({filteredActivities.length})
          </span>
        </div>

        <button
          type="button"
          id="calendar-toggle-btn"
          onClick={() => {
            setShowCalendar(prev => !prev);
            if (!showCalendar && activitiesCount > 0) {
              const targetYm = selectedDate
                ? selectedDate.substring(0, 7)
                : selectedMonth !== 'all'
                  ? selectedMonth
                  : calendarViewYm;
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
          title={showCalendar ? t.browse.closeCalendar : t.browse.filterDateTooltip}
        >
          <Calendar size={13} />
          <span>{showCalendar ? t.browse.close : (selectedDate ? formatDate(`${selectedDate}T00:00:00`, { month: 'short', day: 'numeric' }) : t.browse.calendar)}</span>
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
                ? formatDate(`${selectedDate}T00:00:00`, { month: 'short', day: 'numeric', year: 'numeric' })
                : formatDate(`${selectedMonth}-01`, { month: 'long', year: 'numeric' })}
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
            title={t.browse.showSessionsTooltip}
          >
            <span>{t.common.all}</span>
            <X size={11} />
          </button>
        </div>
      )}

      {/* Interactive Calendar Dropdown / Popover */}
      {showCalendar && (
        <BrowseCalendarPicker
          calendarViewYm={calendarViewYm}
          setCalendarViewYm={setCalendarViewYm}
          availableYears={availableYears}
          activeDatesMap={activeDatesMap}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
          onSelectActivity={onSelectActivity}
          setMobileSubTab={setMobileSubTab}
          language={language}
          t={t}
          activities={filteredActivities}
        />
      )}

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
              {translateTag(tag, t)} <span className="sidebar-filter-count">({count})</span>
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
                <span className="session-month-badge">
                  {group.items.length} {t.browse.runsBadge} • {group.totalKm} km
                </span>
              </div>
            )}
            {group.items.map(a => {
              const isSelected = a.id === selectedActivityId;
              const d = new Date(a.start_time);
              const dateStr = formatDate(d, { month: 'short', day: 'numeric', year: 'numeric' });
              // Clock time (24-hour, locale-aware) is what separates two runs
              // logged on the same calendar day.
              const timeStr = formatDate(d, { hour: '2-digit', minute: '2-digit', hour12: false });
              const dayInfo = sameDayRunInfo.get(a.id);
              const runOfDayLabel = dayInfo
                ? format(t.browse.runOfDay, { index: dayInfo.index, total: dayInfo.total })
                : null;
              const distKm = (a.distance_meters / 1000).toFixed(2);
              const paceStr = formatPace(a.avg_pace_sec_km);
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
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setShowTagMenu(false);
                    onSelectActivity(a.id);
                    setMobileSubTab('detail');
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setShowTagMenu(false);
                      onSelectActivity(a.id);
                      setMobileSubTab('detail');
                    }
                  }}
                >
                  <div className="session-card-top">
                    <span className="session-date">
                      {dateStr}{' '}
                      <span className="session-time">{timeStr}</span>
                    </span>
                    <span className={`run-badge badge-${a.run_type || 'easy_base'}`}>
                      {(t.runTypes as Record<string, string | undefined>)[a.run_type ?? ''] || (a.run_type || 'Easy').replace('_', ' ')}
                    </span>
                  </div>
                  {isRace && <div className="session-name">{getDisplayTitle(a, t)}</div>}
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
                          {translateTag(tag, t)}
                        </span>
                      ))}
                    </div>
                  )}
                  {(
                    <div className="session-card-footer">
                      {runOfDayLabel && (
                        <span className="session-run-of-day" title={runOfDayLabel}>{runOfDayLabel}</span>
                      )}
                      <SessionVerdictBadge verdict={a.verdict} />
                    </div>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}

        {filteredActivities.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#64748b', fontSize: '0.85rem' }}>
            {t.browse.noRunsMatchingFilter}
          </div>
        )}
      </div>

      {!readOnly && <button type="button" className="dropzone-inline" onClick={onOpenUpload}>
        {t.browse.dropOrImportRun}
      </button>}
    </aside>
  );
};
