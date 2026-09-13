const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'runs.db');
const db = new Database(dbPath);

const activities = db.prepare('SELECT id, name, start_time, run_type, auto_run_type, distance_meters, duration_seconds FROM activities ORDER BY start_time DESC').all();

for (const a of activities) {
  const intervals = db.prepare('SELECT interval_index, type, duration_seconds, distance_meters, avg_speed_mps, avg_pace_sec_km, avg_heart_rate, max_heart_rate FROM activity_intervals WHERE activity_id = ? ORDER BY interval_index ASC').all(a.id);
  console.log(`\n======================================================`);
  console.log(`Activity [${a.id}] "${a.name}" (${a.start_time}) - ${a.run_type}`);
  console.log(`Dist: ${(a.distance_meters/1000).toFixed(2)}km, Dur: ${(a.duration_seconds/60).toFixed(1)}min, Intervals count: ${intervals.length}`);
  for (const inv of intervals) {
    const min = (inv.duration_seconds / 60).toFixed(1);
    const pace = `${Math.floor(inv.avg_pace_sec_km / 60)}:${String(Math.floor(inv.avg_pace_sec_km % 60)).padStart(2, '0')}`;
    console.log(`  #${inv.interval_index} [${inv.type}] dur: ${min}m (${inv.duration_seconds}s) | pace: ${pace}/km | avgHR: ${inv.avg_heart_rate} | maxHR: ${inv.max_heart_rate}`);
  }
}
