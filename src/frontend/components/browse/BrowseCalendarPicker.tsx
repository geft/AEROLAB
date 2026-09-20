import React from 'react';
import type { Translations } from '../../i18n/types.js';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext';

interface BrowseCalendarPickerProps {
  calendarViewYm: string;
  setCalendarViewYm: React.Dispatch<React.SetStateAction<string>>;
  availableYears: string[];
  activeDatesMap: Map<string, { count: number; runTypes: string[]; ids: string[] }>;
  selectedDate: string | null;
  setSelectedDate: (d: string | null) => void;
  selectedMonth: string;
  setSelectedMonth: (m: string) => void;
  onSelectActivity: (id: string) => void;
  setMobileSubTab: (tab: 'list' | 'detail') => void;
  language: 'en' | 'zh';
  t: Translations;
  activities?: Array<{ start_time: string }>;
}

export const BrowseCalendarPicker: React.FC<BrowseCalendarPickerProps> = ({
  calendarViewYm,
  setCalendarViewYm,
  availableYears,
  activeDatesMap,
  selectedDate,
  setSelectedDate,
  selectedMonth,
  setSelectedMonth,
  onSelectActivity,
  setMobileSubTab,
  t,
  activities = []
}) => {
  const { formatDate, plural } = useTranslation();
  const [viewYearStr, viewMonthStr] = calendarViewYm.split('-');
  const viewYear = parseInt(viewYearStr, 10);
  const viewMonth = parseInt(viewMonthStr, 10) - 1; // 0-indexed

  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const monthLabel = formatDate(new Date(viewYear, viewMonth, 1), { month: 'long', year: 'numeric' });

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
    setCalendarViewYm(`${viewYear - 1}-${viewMonthStr}`);
  };

  const handleNextYear = () => {
    setCalendarViewYm(`${viewYear + 1}-${viewMonthStr}`);
  };

  const daysOfWeek: string[] = t.browse.weekdayShort;

  return (
    <div
      id="calendar-popover"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 10,
        padding: '0.75rem',
        boxShadow: 'var(--card-shadow)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem'
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
            const count = activities.filter(a => a.start_time?.startsWith(yr)).length;
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

      {/* Month Navigation Bar */}
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
              title={hasSession
                ? `${fullDateStr}: ${plural(sessionEntry?.count ?? 0, t.browse.dayRuns)}`
                : `${fullDateStr}: ${t.browse.dayNoActivity}`}
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

      {/* Calendar Bottom Legend & Quick Reset */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: '0.45rem',
          borderTop: '1px solid var(--border-subtle)',
          flexWrap: 'wrap',
          gap: '0.35rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {(() => {
            let monthRunCount = 0;
            activeDatesMap.forEach((val, dateKey) => {
              if (dateKey.startsWith(calendarViewYm)) {
                monthRunCount += val.count;
              }
            });
            if (monthRunCount === 0) return null;
            const isMonthFiltered = selectedMonth === calendarViewYm && !selectedDate;
            return (
              <button
                type="button"
                onClick={() => {
                  setSelectedDate(null);
                  setSelectedMonth(calendarViewYm);
                }}
                style={{
                  background: isMonthFiltered ? 'rgba(6, 182, 212, 0.2)' : 'transparent',
                  border: isMonthFiltered ? '1px solid var(--accent-cyan)' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: isMonthFiltered ? '#38bdf8' : 'var(--text-secondary)',
                  borderRadius: 4,
                  padding: '0.15rem 0.45rem',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  cursor: 'pointer'
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
              {t.browse?.showAll || 'Show All Runs'}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.66rem', color: 'var(--text-muted)', opacity: 0.85 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: '#10b981' }}>● {t.tags?.easyBase || 'Base'}</span>
            <span style={{ color: '#f59e0b' }}>● {t.tags?.threshold || 'Threshold'}</span>
            <span style={{ color: '#a855f7' }}>● {t.tags?.vo2Max || 'VO2 Max'}</span>
          </span>
        </div>
      </div>
    </div>
  );
};
