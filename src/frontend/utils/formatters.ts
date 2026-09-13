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
 * Formats a date string into a localized human-readable date.
 */
export function formatDate(
  dateStr: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', options);
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
 * Formats an Efficiency Factor (EF) with 2 decimal places.
 */
export function formatEfficiency(ef: number | null | undefined): string {
  if (!ef || isNaN(ef) || ef <= 0) return '—';
  return Number(ef).toFixed(2);
}
