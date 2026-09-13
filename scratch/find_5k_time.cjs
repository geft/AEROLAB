const Database = require('better-sqlite3');
const db = new Database('data/runs.db');

const splits = db.prepare("SELECT * FROM activity_splits WHERE activity_id = '22382891478' ORDER BY split_index ASC").all();
console.log('5K TIME TRIAL SPLITS:');
for (const s of splits) {
  const pace = `${Math.floor(s.avg_pace_sec_km/60)}:${String(Math.floor(s.avg_pace_sec_km%60)).padStart(2,'0')}`;
  console.log(`  km ${s.split_index}: dur ${(s.duration_seconds).toFixed(0)}s | pace ${pace} | HR ${s.avg_heart_rate}`);
}

// Find best 5000m segment in the records of 22382891478
const records = db.prepare("SELECT elapsed_seconds, distance_m FROM activity_records WHERE activity_id = '22382891478' ORDER BY elapsed_seconds ASC").all();
let best5kTime = Infinity;
let bestStartSec = 0;
let bestEndSec = 0;

for (let i = 0; i < records.length; i++) {
  const r1 = records[i];
  for (let j = i + 1; j < records.length; j++) {
    const r2 = records[j];
    const dist = r2.distance_m - r1.distance_m;
    if (dist >= 5000) {
      const dur = r2.elapsed_seconds - r1.elapsed_seconds;
      if (dur < best5kTime) {
        best5kTime = dur;
        bestStartSec = r1.elapsed_seconds;
        bestEndSec = r2.elapsed_seconds;
      }
      break;
    }
  }
}

console.log(`Best 5000m continuous effort: ${best5kTime.toFixed(0)}s (${Math.floor(best5kTime/60)}:${String(Math.floor(best5kTime%60)).padStart(2,'0')}) from sec ${bestStartSec} to ${bestEndSec}`);
