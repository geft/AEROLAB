const Database = require('better-sqlite3');
const db = new Database('data/runs.db');

const thresholds = db.prepare('SELECT * FROM physiological_thresholds ORDER BY effective_date DESC').all();
console.log('PHYSIOLOGICAL THRESHOLDS ROWS:', thresholds);

const profile = db.prepare("SELECT * FROM athlete_profile WHERE id = 'primary'").get();
console.log('ATHLETE PROFILE:', profile.pb_5k, 'upcoming:', profile.upcoming_benchmark);

const latestLt2Row = db.prepare(`
  SELECT lt2_hr, lt2_pace_sec_km, effective_date
  FROM physiological_thresholds
  WHERE lt2_hr IS NOT NULL AND lt2_pace_sec_km IS NOT NULL
  ORDER BY effective_date DESC
  LIMIT 1
`).get();

const avgRecent = db.prepare(`
  SELECT AVG(avg_pace_sec_km) as avg_pace
  FROM activities
  WHERE avg_pace_sec_km IS NOT NULL
`).get();

console.log('latestLt2Row:', latestLt2Row);
console.log('avgRecent:', avgRecent);

// Check 5k time trial activity:
const tt = db.prepare("SELECT * FROM activities WHERE name LIKE '%5k%' OR id = '22382891478'").get();
console.log('5k TT activity:', tt.id, tt.name, 'avg_pace:', tt.avg_pace_sec_km, 'dur:', tt.duration_seconds, 'dist:', tt.distance_meters);
