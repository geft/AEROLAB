import { getDatabase } from '../src/backend/db/client.js';

const db = getDatabase();
const acts = db.prepare('SELECT id, name, start_time, run_type, auto_run_type, tags FROM activities ORDER BY start_time DESC').all();
console.log('UPDATED ACTIVITIES:');
for (const a of acts as any[]) {
  console.log(`- [${a.id}] ${a.start_time} | "${a.name}" | type: ${a.run_type} | tags: ${a.tags}`);
}

const thresholds = db.prepare('SELECT * FROM physiological_thresholds ORDER BY effective_date DESC').all();
console.log('\nUPDATED THRESHOLDS:');
for (const t of thresholds as any[]) {
  console.log(`- Date: ${t.effective_date} | LT1: ${t.lt1_hr}bpm (${t.lt1_pace_sec_km}s/km) | LT2: ${t.lt2_hr}bpm (${t.lt2_pace_sec_km}s/km) | Notes: ${t.notes}`);
}
