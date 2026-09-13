const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'runs.db');
const db = new Database(dbPath);

const runs = db.prepare('SELECT id, name, start_time, run_type, auto_run_type, distance_meters, duration_seconds, avg_heart_rate, max_heart_rate, tags FROM activities ORDER BY start_time DESC').all();
console.log('TOTAL RUNS IN DB:', runs.length);
for (const r of runs) {
  console.log(`- [${r.id}] ${r.start_time} | "${r.name}" | type: ${r.run_type} (auto: ${r.auto_run_type}) | dist: ${(r.distance_meters/1000).toFixed(2)}km | dur: ${Math.round(r.duration_seconds/60)}m | HR: ${r.avg_heart_rate}/${r.max_heart_rate} | tags: ${r.tags}`);
}
