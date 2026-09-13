const Database = require('better-sqlite3');
const db = new Database('data/runs.db');

const activities = db.prepare('SELECT * FROM activities ORDER BY start_time ASC').all();
const profile = db.prepare("SELECT * FROM athlete_profile WHERE id = 'primary'").get();

console.log('ATHLETE PROFILE:');
console.log(`Max HR: ${profile.max_hr}, Resting HR: ${profile.resting_hr}, LT1: ${profile.lt1_hr}, LT2: ${profile.lt2_hr}, Z4 Start: ${profile.z4_start_hr}`);

for (const a of activities) {
  const records = db.prepare('SELECT * FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(a.id);
  const intervals = db.prepare('SELECT * FROM activity_intervals WHERE activity_id = ? ORDER BY interval_index ASC').all(a.id);
  
  // Calculate HR distribution
  const hrCounts = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  let validHr = 0;
  for (const r of records) {
    if (!r.heart_rate) continue;
    validHr++;
    if (r.heart_rate < profile.lt1_hr) hrCounts.z2++; // < LT1 is easy/base
    else if (r.heart_rate < profile.lt2_hr) hrCounts.z3++; // LT1 to LT2 (tempo/aerobic)
    else if (r.heart_rate < profile.max_hr * 0.92) hrCounts.z4++; // LT2 to 92% max HR (threshold)
    else hrCounts.z5++; // >= 92% max HR (VO2 / max)
  }

  console.log('\n================================================================');
  console.log(`RUN: [${a.id}] "${a.name}" on ${a.start_time}`);
  console.log(`Classified: ${a.run_type} | Tags: ${a.tags}`);
  console.log(`Dist: ${(a.distance_meters/1000).toFixed(2)} km, Dur: ${(a.duration_seconds/60).toFixed(1)} min, Avg HR: ${a.avg_heart_rate}, Max HR: ${a.max_heart_rate}`);
  console.log(`HR in zones: Z1/Z2 (<${profile.lt1_hr}): ${Math.round(hrCounts.z2/validHr*100)}% | Z3 (${profile.lt1_hr}-${profile.lt2_hr}): ${Math.round(hrCounts.z3/validHr*100)}% | Z4 (${profile.lt2_hr}-186): ${Math.round(hrCounts.z4/validHr*100)}% | Z5 (>186): ${Math.round(hrCounts.z5/validHr*100)}%`);
  console.log(`Intervals detected: ${intervals.length}`);
  for (const inv of intervals) {
    console.log(`  #${inv.interval_index} [${inv.type}] dur: ${(inv.duration_seconds/60).toFixed(1)}m (${Math.round(inv.duration_seconds)}s) | pace: ${(inv.avg_pace_sec_km/60).toFixed(2)} | avgHR: ${inv.avg_heart_rate} | maxHR: ${inv.max_heart_rate}`);
  }
}
