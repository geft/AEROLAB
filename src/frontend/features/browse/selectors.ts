import { en } from '../../i18n/en.js';
import type { Activity, ActivityUpdate } from '../../types/api.js';
import type { Translations } from '../../i18n/types.js';
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
