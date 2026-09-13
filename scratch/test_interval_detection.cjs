const Database = require('better-sqlite3');
const db = new Database('data/runs.db');

const records = db.prepare('SELECT elapsed_seconds as elapsedSeconds, speed_mps as speedMps, heart_rate as heartRate, cadence, distance_m as distanceMeters, stance_time as stanceTime FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all('24183111956');

// In 24183111956, let's see how we can detect the 4x4min reps cleanly
// Moving average speed (window 15s) and HR
const smoothedSpeed = [];
const smoothedHr = [];
const w = 10;
for (let i = 0; i < records.length; i++) {
  let sSum = 0, hrSum = 0, c = 0;
  for (let j = Math.max(0, i - w); j <= Math.min(records.length - 1, i + w); j++) {
    if (records[j].speedMps) sSum += records[j].speedMps;
    if (records[j].heartRate) hrSum += records[j].heartRate;
    c++;
  }
  smoothedSpeed.push(sSum / c);
  smoothedHr.push(hrSum / c);
}

// Let's find moving speeds
const movingSpeeds = records.map(r => r.speedMps || 0).filter(s => s > 0.5).sort((a,b)=>a-b);
const medianSpeed = movingSpeeds[Math.floor(movingSpeeds.length * 0.5)];
const p85Speed = movingSpeeds[Math.floor(movingSpeeds.length * 0.85)];
const p20Speed = movingSpeeds[Math.floor(movingSpeeds.length * 0.2)];
console.log('medianSpeed:', medianSpeed, 'p85:', p85Speed, 'p20:', p20Speed);

// Threshold between work and recovery:
// If p85 - p20 >= 0.7 m/s, speed threshold can be (p85 + p20) / 2 or weighted
const speedThresh = (p85Speed + p20Speed) / 2;
console.log('speedThresh:', speedThresh, 'pace:', 1000/speedThresh);

// Label states
const states = records.map(r => {
  const spd = r.speedMps || 0;
  const cad = r.cadence || 0;
  return (spd >= speedThresh && cad >= 145) ? 'work' : 'recovery';
});

// Segment into raw blocks
const rawBlocks = [];
let cur = states[0];
let start = 0;
for (let i = 1; i < states.length; i++) {
  if (states[i] !== cur) {
    rawBlocks.push({ type: cur, start, end: i - 1 });
    cur = states[i];
    start = i;
  }
}
rawBlocks.push({ type: cur, start, end: states.length - 1 });

// Filter out blocks < 20s
const filtered = rawBlocks.filter(b => {
  const dur = records[b.end].elapsedSeconds - records[b.start].elapsedSeconds;
  return dur >= 20;
});

console.log('Detected blocks:');
for (const b of filtered) {
  const dur = records[b.end].elapsedSeconds - records[b.start].elapsedSeconds;
  const blockRecs = records.slice(b.start, b.end + 1);
  const avgHr = Math.round(blockRecs.reduce((s, r) => s + (r.heartRate || 0), 0) / blockRecs.length);
  const avgSpd = blockRecs.reduce((s, r) => s + (r.speedMps || 0), 0) / blockRecs.length;
  const pace = `${Math.floor(1000/avgSpd/60)}:${String(Math.floor((1000/avgSpd)%60)).padStart(2, '0')}`;
  console.log(`  ${b.type}: ${(dur/60).toFixed(1)}m (${dur}s) | pace: ${pace}/km | avgHR: ${avgHr}`);
}
