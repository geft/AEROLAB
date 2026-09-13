const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'runs.db');
const db = new Database(dbPath);

const records = db.prepare('SELECT elapsed_seconds as elapsedSeconds, speed_mps as speedMps, heart_rate as heartRate, cadence, distance_m as distanceMeters, stance_time as stanceTime FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all('24183111956');

console.log('Record count:', records.length);

const allSpeeds = records
  .map(r => r.speedMps ?? 0)
  .filter(s => s > 0.3)
  .sort((a, b) => a - b);

let maxGap = 0;
let gapMidpoint = Infinity;
for (let i = 1; i < allSpeeds.length; i++) {
  const gap = allSpeeds[i] - allSpeeds[i - 1];
  if (gap > maxGap) {
    maxGap = gap;
    gapMidpoint = (allSpeeds[i] + allSpeeds[i - 1]) / 2;
  }
}
console.log('maxGap:', maxGap, 'gapMidpoint:', gapMidpoint);
