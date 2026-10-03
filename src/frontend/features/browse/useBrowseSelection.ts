import { useState, useEffect, useMemo, useRef } from 'react';
import type { ActivitySummary, BrowseViewProps } from './selectors.js';
import { doesActivityMatchTag } from './selectors.js';
import { useTranslation } from '../../i18n/LanguageContext.js';

const SIDEBAR_FILTER_TAGS = [
  'All', 'Threshold', 'VO2 Max', 'Easy Base', 'Long Run', 'Race', 'Strides', 'Marathon Pace', 'Recovery'
];

export function useBrowseSelection(activities: ActivitySummary[], selectedActivityId: string | null, onSelectActivity: BrowseViewProps['onSelectActivity']) {
  const safeActivities = useMemo(() => (Array.isArray(activities) ? activities : []), [activities]);
  const { t, formatDate } = useTranslation();
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState<boolean>(false);
  const [calendarViewYm, setCalendarViewYm] = useState<string>(() => {
    return safeActivities[0]?.start_time ? safeActivities[0].start_time.substring(0, 7) : new Date().toISOString().substring(0, 7);
  });
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('all');
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

  const [previousSelection, setPreviousSelection] = useState(selectedActivityId);
  if (previousSelection !== selectedActivityId) {
    setPreviousSelection(selectedActivityId);
    setShowTagMenu(false);
    const target = safeActivities.find(a => a.id === selectedActivityId);
    if (previousSelection && target) {
      if (selectedMonth !== 'all' && !target.start_time?.startsWith(selectedMonth)) setSelectedMonth('all');
      if (selectedTagFilter !== 'all' && !doesActivityMatchTag(target, selectedTagFilter)) setSelectedTagFilter('all');
      setMobileSubTab('detail');
    }
  }

  return { safeActivities, selectedMonth, setSelectedMonth, selectedDate, setSelectedDate, showCalendar, setShowCalendar,
    calendarViewYm, setCalendarViewYm, selectedTagFilter, setSelectedTagFilter, mobileSubTab, setMobileSubTab,
    showTagMenu, setShowTagMenu, tagMenuRef, tagCounts, availableYears, activeDatesMap, filteredActivities, groupedActivities };
}
