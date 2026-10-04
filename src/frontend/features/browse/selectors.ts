import { sessionTags } from '../../../shared/session-tags.js';
import { en } from '../../i18n/en.js';
import type { Activity, ActivityUpdate } from '../../types/api.js';
import type { Translations } from '../../i18n/types.js';
/** Shared list keeps visible filters and their counts in sync. */
export const SIDEBAR_FILTER_TAGS = [
  'All', 'Threshold', 'Tempo', 'VO2 Max', 'Easy Base', 'Long Run', 'Race', 'Strides', 'Recovery'
];

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
  readOnly?: boolean;
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

  const titles = en.browse.defaultTitles;
  return titles[activity.run_type as keyof typeof titles] || titles.generic;
}

const PRIMARY_FILTER_TYPES: Record<string, string> = {
  threshold: 'threshold_lt2', 'vo2 max': 'intervals_vo2', 'easy base': 'easy_base',
  'long run': 'long_run', race: 'race', recovery: 'recovery', tempo: 'tempo'
};

/** Hide stale or manually added primary tags that contradict the classification. */
export function getActivityTags(a: Pick<Activity, 'tags' | 'run_type'>): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(a.tags || '[]');
  } catch {
    return sessionTags(a.run_type, []);
  }
  if (!Array.isArray(parsed)) return sessionTags(a.run_type, []);
  return sessionTags(a.run_type, parsed.filter((tag): tag is string => typeof tag === 'string'));
}

export function doesActivityMatchTag(a: ActivitySummary, tag: string): boolean {
  if (!tag || tag.toLowerCase() === 'all') return true;
  const lower = tag.toLowerCase();
  const primaryType = PRIMARY_FILTER_TYPES[lower];
  if (primaryType && a.run_type) return a.run_type === primaryType;
  const tagsArr = getActivityTags(a);
  if (tagsArr.some(t => t.toLowerCase() === lower)) return true;
  if (lower === 'strides' && (a.run_type === 'strides' || tagsArr.some(t => t.toLowerCase().includes('stride')))) return true;
  return false;
}
