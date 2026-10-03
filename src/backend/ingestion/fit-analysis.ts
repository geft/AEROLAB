import type { ActivityRecord } from './csv-parser.js';

export interface AnalysisLap { start: number; end: number; intensity: string }
export interface FitAnalysis { records: ActivityRecord[]; laps: AnalysisLap[] }
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const messages = (value: unknown) => Array.isArray(value) ? value.map(object) : [];

/** FIT messages use UTC; exported record timestamps are local wall-clock ISO.
 * Anchor to the first record, not session start: elapsedSeconds uses that origin.
 * Raw records are never changed, so export retains stopped-time telemetry.
 */
export function prepareFitAnalysis(records: ActivityRecord[], metadata?: Record<string, unknown> | null): FitAnalysis {
  if (!metadata || !records.length) return { records, laps: [] };
  const offset = typeof metadata.utcOffsetSeconds === 'number' ? metadata.utcOffsetSeconds : 0;
  const stamp = records[0].timestamp.replace(' ', 'T');
  const origin = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(stamp) ? stamp : `${stamp}Z`) - offset * 1000 - records[0].elapsedSeconds * 1000;
  const seconds = (value: unknown) => typeof value === 'string' ? (Date.parse(value) - origin) / 1000 : NaN;
  const end = records.at(-1)!.elapsedSeconds;
  const events = messages(metadata.events).flatMap(event => {
    const at = seconds(event.timestamp);
    const kind = String(event.event_type).replace(/_/g, '').toLowerCase();
    if (event.event !== 'timer' || !Number.isFinite(at) || at < -15 || at > end + 15) return [];
    return kind === 'start' ? [{ at, active: true }] :
      ['stop', 'stopall', 'stopdisable', 'stopdisableall'].includes(kind) ? [{ at, active: false }] : [];
  }).sort((a, b) => a.at - b.at);
  const laps = messages(metadata.laps).flatMap(lap => {
    const start = seconds(lap.start_time);
    const duration = lap.total_elapsed_time;
    const finish = typeof duration === 'number' && Number.isFinite(duration) ? start + duration : seconds(lap.timestamp);
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start || start < -15 || finish > end + 15) return [];
    const clippedStart = Math.max(0, start), clippedEnd = Math.min(end, finish);
    return clippedEnd > clippedStart ? [{ start: clippedStart, end: clippedEnd, intensity: String(lap.intensity).toLowerCase() }] : [];
  }).sort((a, b) => a.start - b.start);
  // Contradictory/overlapping laps cannot provide structure evidence.
  // FIT timestamps have whole-second precision while elapsed durations have
  // fractions. Clip subsecond overlap at the next recorded lap boundary.
  const validLaps = laps.some((lap, index) => index > 0 && lap.start < laps[index - 1].end - 1) ? [] :
    laps.map((lap, index) => ({ ...lap, end: Math.min(lap.end, laps[index + 1]?.start ?? Infinity) }));
  if (!events.length) return { records, laps: validLaps };
  let active = true, segment = 0, cursor = 0, stoppedAt: number | null = null;
  const annotated = records.map((record, index) => {
    let pauseSeconds = 0;
    while (cursor < events.length && events[cursor].at <= record.elapsedSeconds) {
      const event = events[cursor++];
      if (!event.active && active) stoppedAt = Math.max(0, event.at);
      if (event.active && !active && stoppedAt !== null) {
        pauseSeconds += Math.max(0, event.at - stoppedAt);
        stoppedAt = null;
      }
      if (event.active !== active) segment++;
      active = event.active;
    }
    if (index === records.length - 1 && stoppedAt !== null) pauseSeconds += Math.max(0, end - stoppedAt);
    return { ...record, timerActive: active, timerSegment: segment, timerPauseSeconds: pauseSeconds };
  });
  return { records: annotated, laps: validLaps };
}
