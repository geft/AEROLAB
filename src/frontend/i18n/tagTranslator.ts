import { Translations } from './types.js';

/**
 * Translates a raw workout tag (e.g. "Easy Base", "Strides", "Threshold")
 * into the active language translation.
 */
export function translateTag(tag: string, t: Translations): string {
  if (!tag) return '';
  const key = tag.trim().toLowerCase();

  switch (key) {
    case 'all':
      return t.common.all || 'All';
    case 'easy base':
    case 'easy_base':
    case 'easy':
      return t.tags.easyBase;
    case 'threshold':
    case 'threshold_lt2':
    case 'lt2':
      return t.tags.threshold;
    case 'vo2 max':
    case 'vo2max':
    case 'intervals_vo2':
      return t.tags.vo2Max;
    case 'long run':
    case 'long_run':
      return t.tags.longRun;
    case 'recovery':
      return t.tags.recovery;
    case 'race':
      return t.tags.race;
    case 'strides':
      return t.tags.strides;
    case 'hills':
      return t.tags.hills;
    case 'tempo':
      return t.tags.tempo;
    case 'marathon pace':
    case 'marathon':
      return t.tags.marathonPace;
    default:
      return tag;
  }
}
