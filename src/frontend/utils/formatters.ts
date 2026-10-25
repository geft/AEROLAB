import { formatDateValue } from '../i18n/date-format.js';
import { LOCALES } from '../i18n/types.js';
/**
 * Shared formatting utilities for running metrics, pace, dates, and durations.
 */

/**
 * Formats a pace in seconds per kilometer to "M:SS/km" or "M:SS".
 * Returns "—" if secKm is null or invalid.
 */
export function formatPace(secKm: number | null | undefined, includeUnit: boolean = true): string {
  if (!secKm || isNaN(secKm) || secKm <= 0) return '—';
  const mins = Math.floor(secKm / 60);
  const secs = Math.round(secKm % 60);
  const paddedSecs = String(secs).padStart(2, '0');
  return includeUnit ? `${mins}:${paddedSecs}/km` : `${mins}:${paddedSecs}`;
}

/**
 * Formats full dates as YYYYMMDD; explicit partial-date options remain localized.
 */
export function formatDate(
  dateStr: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return formatDateValue(d, LOCALES.en, options);
  } catch {
    return dateStr;
  }
}

/**
 * Formats a duration in seconds into "H:MM:SS" or "MM:SS".
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Parses a "45:58" or "3:52:10" clock time into seconds.
 * A bare number is rejected: "2758" is more likely a typo for 27:58.
 */
export function parseDuration(input: string): number | null {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every(part => /^\d{1,3}$/.test(part))) return null;
  // Only the leading field may exceed 59, so "45:75" is a typo rather than 46:15.
  if (parts.slice(1).some(part => Number(part) > 59)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return seconds > 0 ? seconds : null;
}

/**
 * Formats an Efficiency Factor (EF) with 2 decimal places.
 */
export function formatEfficiency(ef: number | null | undefined): string {
  if (!ef || isNaN(ef) || ef <= 0) return '—';
  return Number(ef).toFixed(2);
}

/**
 * Calculates dynamic age in years from a birth date string (YYYY-MM-DD or YYYY-MM).
 */
export { ageFromDob as calculateAgeFromDob } from '../../shared/heart-rate.js';
