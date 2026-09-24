import type { Activity, ActivityRecord } from '../types/api.js';

/** Export the telemetry retained in the local database in the importable CSV layout. */
export function sessionToCsv(activity: Activity, records: ActivityRecord[]): string {
  const meta = (value: string | number | null | undefined) => String(value ?? '').replace(/[\r\n]+/g, ' ');
  const cell = (value: string | number | null | undefined) => value == null ? '' : String(value);
  const lines = [
    '# AEROLAB Session Export',
    `# Activity: ${meta(activity.name || 'Run')}`,
    `# Activity ID: ${meta(activity.id)}`,
    `# Date: ${meta(activity.start_time)}`,
    `# Sport: ${meta(activity.sport || 'running')}`,
    `# Total Distance (m): ${meta(activity.distance_meters)}`,
    `# Total Duration (s): ${meta(activity.duration_seconds)}`,
    `# Total Elapsed Time (s): ${meta(activity.elapsed_seconds ?? activity.duration_seconds)}`,
    `# Avg Heart Rate (bpm): ${meta(activity.avg_heart_rate)}`,
    `# Max Heart Rate (bpm): ${meta(activity.max_heart_rate)}`,
    `# Avg Cadence (spm): ${meta(activity.avg_cadence)}`,
    `# Max Cadence (spm): ${meta(activity.max_cadence)}`,
    `# Calories: ${meta(activity.calories)}`,
    `# Total Ascent (m): ${meta(activity.elevation_gain_m)}`,
    `# Total Descent (m): ${meta(activity.elevation_loss_m)}`,
    'timestamp,heart_rate,cadence (spm),enhanced_speed,distance,enhanced_altitude,position_lat,position_long,temperature,vertical_oscillation,stance_time',
  ];
  for (const record of records) {
    lines.push([
      record.timestamp, record.heart_rate, record.cadence, record.speed_mps,
      record.distance_m, record.altitude_m, record.lat, record.lon,
      record.temp, record.vert_osc, record.stance_time,
    ].map(cell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function downloadSessionCsv(activity: Activity, records: ActivityRecord[]): void {
  const csv = sessionToCsv(activity, records);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${activity.start_time.slice(0, 10)}-${activity.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
