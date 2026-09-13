const Database = require('better-sqlite3');
const db = new Database('data/runs.db');

const profile = db.prepare("SELECT * FROM athlete_profile WHERE id = 'primary'").get();
const lt1Hr = profile.lt1_hr || 153;
const lt2Hr = profile.lt2_hr || 167;
const maxHr = profile.max_hr || 203;

console.log('ATHLETE PROFILE THRESHOLDS:', { lt1Hr, lt2Hr, maxHr });

const activities = db.prepare('SELECT id, start_time, distance_meters, duration_seconds, run_type FROM activities ORDER BY start_time DESC').all();

function computeAggregates(acts) {
  let totalDistM = 0;
  let totalDurSec = 0;
  let z1z2Sec = 0;
  let z3Sec = 0;
  let z4Sec = 0;
  let z5Sec = 0;

  for (const a of acts) {
    totalDistM += a.distance_meters || 0;
    totalDurSec += a.duration_seconds || 0;
    const records = db.prepare('SELECT elapsed_seconds, heart_rate FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(a.id);
    for (let i = 1; i < records.length; i++) {
      const dt = Math.max(0, Math.min(10, records[i].elapsed_seconds - records[i-1].elapsed_seconds));
      const hr = records[i].heart_rate;
      if (!hr) continue;
      if (hr < lt1Hr) z1z2Sec += dt;
      else if (hr < lt2Hr) z3Sec += dt;
      else if (hr < maxHr * 0.92) z4Sec += dt;
      else z5Sec += dt;
    }
  }

  const totalHrSec = z1z2Sec + z3Sec + z4Sec + z5Sec;
  return {
    count: acts.length,
    distanceKm: (totalDistM / 1000).toFixed(1),
    totalHours: (totalDurSec / 3600).toFixed(1),
    z2Hours: (z1z2Sec / 3600).toFixed(1),
    z2Pct: totalHrSec > 0 ? Math.round((z1z2Sec / totalHrSec) * 100) : 0,
    z3Hours: (z3Sec / 3600).toFixed(1),
    z3Pct: totalHrSec > 0 ? Math.round((z3Sec / totalHrSec) * 100) : 0,
    z4Hours: (z4Sec / 3600).toFixed(1),
    z4Pct: totalHrSec > 0 ? Math.round((z4Sec / totalHrSec) * 100) : 0,
    z5Hours: (z5Sec / 3600).toFixed(1),
    z5Pct: totalHrSec > 0 ? Math.round((z5Sec / totalHrSec) * 100) : 0
  };
}

console.log('ALL-TIME STATS:', computeAggregates(activities));

// September 2026 runs:
const septRuns = activities.filter(a => a.start_time.startsWith('2026-09'));
console.log('SEPTEMBER 2026 STATS:', computeAggregates(septRuns));
