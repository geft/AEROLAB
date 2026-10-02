import type { Activity, ActivityRecord } from '../types/api.js';

/** Export the telemetry retained in the local database in the importable CSV layout. */
export function sessionToCsv(activity: Activity, records: ActivityRecord[], fitMetadata?: Record<string, unknown> | null): string {
  const meta = (value: string | number | null | undefined) => String(value ?? '').replace(/[\r\n]+/g, ' ');
  const cell = (value: unknown) => {
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const optionalColumns: Array<[string, keyof ActivityRecord]> = [
    ['power', 'power_w'], ['vertical_ratio', 'vertical_ratio'], ['stance_time_balance', 'stance_time_balance'],
    ['step_length', 'step_length_m'], ['fractional_cadence', 'fractional_cadence'],
    ['respiration_rate', 'respiration_rate'], ['core_temperature', 'core_temperature_c'], ['fit_fields', 'fit_fields_json'],
  ];
  const extraColumns = optionalColumns.filter(([, key]) => records.some(record => record[key] != null));
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
  ];
  if (fitMetadata || extraColumns.length) lines.push('# FIT Export Version: 2');
  if (fitMetadata) lines.push(`# FIT Metadata: ${JSON.stringify(fitMetadata)}`);
  lines.push(['timestamp,heart_rate,cadence (spm),enhanced_speed,distance,enhanced_altitude,position_lat,position_long,temperature,vertical_oscillation,stance_time', ...extraColumns.map(([name]) => name)].join(','));
  for (const record of records) {
    lines.push([
      record.timestamp, record.heart_rate, record.cadence, record.speed_mps,
      record.distance_m, record.altitude_m, record.lat, record.lon,
      record.temp, record.vert_osc, record.stance_time,
      ...extraColumns.map(([, key]) => key === 'fit_fields_json' && record.fit_fields_json ? JSON.parse(record.fit_fields_json) : record[key]),
    ].map(cell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function downloadSessionCsv(activity: Activity, records: ActivityRecord[], fitMetadata?: Record<string, unknown> | null): void {
  const csv = sessionToCsv(activity, records, fitMetadata);
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
