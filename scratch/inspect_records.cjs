const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'runs.db');
const db = new Database(dbPath);

function inspectActivity(id) {
  const act = db.prepare('SELECT id, name, start_time, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate FROM activities WHERE id = ?').get(id);
  console.log(`\n=== ACTIVITY ${id}: ${act.name} ===`);
  const records = db.prepare('SELECT elapsed_seconds, speed_mps, heart_rate, cadence, distance_m FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(id);
  console.log(`Total records: ${records.length}`);
  if (records.length === 0) return;

  // Let's sample every 30s or find peak speeds/HR
  const maxHr = Math.max(...records.map(r => r.heart_rate || 0));
  const maxSpd = Math.max(...records.map(r => r.speed_mps || 0));
  const avgSpd = records.reduce((s, r) => s + (r.speed_mps || 0), 0) / records.length;
  console.log(`Max HR: ${maxHr}, Max Speed: ${maxSpd.toFixed(2)} m/s (${(1000/maxSpd).toFixed(0)} s/km), Avg Speed: ${avgSpd.toFixed(2)} m/s`);

  // Print 1-minute summaries
  let currentMin = 0;
  let minHr = 0, minSpd = 0, count = 0;
  for (const r of records) {
    const min = Math.floor(r.elapsed_seconds / 60);
    if (min !== currentMin) {
      if (count > 0) {
        const paceSec = minSpd > 0 ? Math.round(1000 / (minSpd / count)) : 0;
        const paceStr = `${Math.floor(paceSec/60)}:${String(paceSec%60).padStart(2,'0')}`;
        if (currentMin % 2 === 0 || (minHr/count) > 165) {
          console.log(`  min ${currentMin}: pace ${paceStr}/km, HR ${Math.round(minHr/count)}`);
        }
      }
      currentMin = min;
      minHr = 0;
      minSpd = 0;
      count = 0;
    }
    minHr += (r.heart_rate || 0);
    minSpd += (r.speed_mps || 0);
    count++;
  }
}

inspectActivity('24183111956'); // VO2Max
inspectActivity('22382891478'); // 5k Time Trial
inspectActivity('24269710540'); // Medium Run with Strides
