import type { ActivityRecord } from './telemetry.js';
import { MAX_OBSERVED_GAP_SECONDS, sameTimerSegment } from '../physiology/time-series.js';

/** Repair analysis copies only. Raw samples remain the source for export. */
export function repairSpeedTelemetry(records: ActivityRecord[]): ActivityRecord[] {
  if (records.length < 20) return records;
  const speeds = records.flatMap(r => r.speedMps != null && r.speedMps > 0 ? [r.speedMps] : []);
  const hasDistance = records.filter(r => r.distanceMeters != null && r.distanceMeters > 0).length >= 20;
  const flat = speeds.length >= 20 && Math.max(...speeds) - Math.min(...speeds) < 0.15 && Math.min(...speeds) > 1;
  if (!hasDistance || (!flat && speeds.length !== 0)) return records;
  const repaired = records.map((record, index) => {
    if (record.distanceMeters == null || record.timerActive === false) return record;
    let from = index, to = index;
    const connected = (a: ActivityRecord, b: ActivityRecord) => sameTimerSegment(a, b) &&
      b.elapsedSeconds > a.elapsedSeconds && b.elapsedSeconds - a.elapsedSeconds <= MAX_OBSERVED_GAP_SECONDS;
    while (from > 0 && record.elapsedSeconds - records[from].elapsedSeconds < 5 && connected(records[from - 1], records[from])) from--;
    while (to < records.length - 1 && records[to].elapsedSeconds - record.elapsedSeconds < 5 && connected(records[to], records[to + 1])) to++;
    const a = records[from], b = records[to];
    const seconds = b.elapsedSeconds - a.elapsedSeconds;
    if (a.distanceMeters == null || b.distanceMeters == null || seconds < 2 || b.distanceMeters < a.distanceMeters) return record;
    return { ...record, speedMps: Number(Math.max(0, Math.min(9, (b.distanceMeters - a.distanceMeters) / seconds)).toFixed(3)) };
  });
  return repaired.some((record, index) => record.speedMps !== records[index].speedMps) ? repaired : records;
}
