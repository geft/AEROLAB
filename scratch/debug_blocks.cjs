const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'data', 'runs.db');
const db = new Database(dbPath);

const records = db.prepare('SELECT elapsed_seconds as elapsedSeconds, speed_mps as speedMps, heart_rate as heartRate, cadence, distance_m as distanceMeters, stance_time as stanceTime FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all('24183111956');

// Let's test the states and smoothing
const sessionMaxHr = Math.max(...records.map(r => r.heartRate ?? 0));
const hrWorkThreshold = sessionMaxHr * 0.85;
console.log('sessionMaxHr:', sessionMaxHr, 'hrWorkThreshold:', hrWorkThreshold);

const states = records.map(r => {
  const cad = r.cadence ?? 0;
  const hr = r.heartRate ?? 0;
  return (hr >= hrWorkThreshold && cad >= 135) ? 'work' : 'recovery';
});

console.log('Work votes count:', states.filter(s => s === 'work').length);
console.log('Recovery votes count:', states.filter(s => s === 'recovery').length);

// Smoothed
const smoothed = [];
const windowSize = 4;
for (let i = 0; i < states.length; i++) {
  let workVotes = 0;
  let totalVotes = 0;
  for (let w = -windowSize; w <= windowSize; w++) {
    const idx = i + w;
    if (idx >= 0 && idx < states.length) {
      if (states[idx] === 'work') workVotes++;
      totalVotes++;
    }
  }
  smoothed.push(workVotes / totalVotes >= 0.5 ? 'work' : 'recovery');
}

// Raw blocks
const rawBlocks = [];
let currentType = smoothed[0];
let startIndex = 0;
for (let i = 1; i < smoothed.length; i++) {
  if (smoothed[i] !== currentType) {
    rawBlocks.push({ type: currentType, startIndex, endIndex: i - 1 });
    currentType = smoothed[i];
    startIndex = i;
  }
}
rawBlocks.push({ type: currentType, startIndex, endIndex: smoothed.length - 1 });

console.log('Raw blocks count:', rawBlocks.length);
for (const b of rawBlocks) {
  const dur = records[b.endIndex].elapsedSeconds - records[b.startIndex].elapsedSeconds;
  const recs = b.endIndex - b.startIndex + 1;
  console.log(`  ${b.type}: ${dur}s (${recs} records)`);
}
