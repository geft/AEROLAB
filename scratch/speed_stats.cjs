const Database = require('better-sqlite3');
const db = new Database('data/runs.db');

const activities = db.prepare('SELECT id, name, start_time, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate FROM activities ORDER BY start_time ASC').all();

for (const a of activities) {
  const records = db.prepare('SELECT elapsed_seconds, speed_mps, heart_rate, cadence FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(a.id);
  const movingSpeeds = records.map(r => r.speed_mps || 0).filter(s => s > 0.5).sort((a, b) => a - b);
  const p10 = movingSpeeds[Math.floor(movingSpeeds.length * 0.1)] || 0;
  const p25 = movingSpeeds[Math.floor(movingSpeeds.length * 0.25)] || 0;
  const p50 = movingSpeeds[Math.floor(movingSpeeds.length * 0.5)] || 0;
  const p75 = movingSpeeds[Math.floor(movingSpeeds.length * 0.75)] || 0;
  const p90 = movingSpeeds[Math.floor(movingSpeeds.length * 0.9)] || 0;
  const p95 = movingSpeeds[Math.floor(movingSpeeds.length * 0.95)] || 0;

  console.log(`[${a.id}] "${a.name}": p25=${p25.toFixed(2)}, p50=${p50.toFixed(2)}, p75=${p75.toFixed(2)}, p90=${p90.toFixed(2)}, p95=${p95.toFixed(2)} | spread (p90-p25)=${(p90-p25).toFixed(2)} m/s`);
}
