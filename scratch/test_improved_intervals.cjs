const Database = require('better-sqlite3');
const db = new Database('data/runs.db');

function detectIntervalsImproved(records) {
  if (!records || records.length < 60) return [];

  const movingSpeeds = records
    .map(r => r.speed_mps ?? 0)
    .filter(s => s > 0.5)
    .sort((a, b) => a - b);

  const sessionMaxHr = Math.max(...records.map(r => r.heart_rate ?? 0));
  const hrWorkThreshold = sessionMaxHr > 140 ? sessionMaxHr * 0.82 : 160;

  let workSpeedThreshold = Infinity;
  let hasSpeedContrast = false;

  if (movingSpeeds.length > 30) {
    const p85 = movingSpeeds[Math.floor(movingSpeeds.length * 0.85)];
    const p20 = movingSpeeds[Math.floor(movingSpeeds.length * 0.20)];
    // Quality intervals have meaningful speed spread and work speed is actively fast
    if (p85 - p20 >= 0.7 && p85 >= 3.2) {
      hasSpeedContrast = true;
      // Work threshold sits between recovery and fast work pace
      workSpeedThreshold = Math.max(3.1, (p85 + p20) / 2);
    }
  }

  // Label seconds as work or recovery
  const states = records.map(r => {
    const cad = r.cadence ?? 0;
    const spd = r.speed_mps ?? 0;
    const hr  = r.heart_rate ?? 0;

    // Check for stride candidate (fast burst)
    if (spd >= 3.5 && cad >= 175) return 'work';

    if (hasSpeedContrast) {
      // Work if speed meets threshold, cadence is running turnover, and not ultra-low HR
      return (spd >= workSpeedThreshold && cad >= 145) ? 'work' : 'recovery';
    }

    // HR fallback if no speed contrast but high sustained HR spikes (treadmill / hills)
    if (sessionMaxHr >= 160 && hr >= hrWorkThreshold && cad >= 145 && spd >= 2.5) {
      return 'work';
    }

    return 'recovery';
  });

  // Smooth (window 4s)
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

  // Segment
  const rawBlocks = [];
  let cur = smoothed[0];
  let start = 0;
  for (let i = 1; i < smoothed.length; i++) {
    if (smoothed[i] !== cur) {
      rawBlocks.push({ type: cur, startIndex: start, endIndex: i - 1 });
      cur = smoothed[i];
      start = i;
    }
  }
  rawBlocks.push({ type: cur, startIndex: start, endIndex: smoothed.length - 1 });

  // Merge tiny blips (< 12s)
  const merged = [];
  for (const b of rawBlocks) {
    const dur = records[b.endIndex].elapsed_seconds - records[b.startIndex].elapsed_seconds;
    if (dur < 12 && merged.length > 0) {
      // absorb into previous block
      merged[merged.length - 1].endIndex = b.endIndex;
    } else {
      merged.push({ ...b });
    }
  }

  // Filter out blocks < 15s for work, < 12s for recovery
  const validBlocks = merged.filter(b => {
    const dur = records[b.endIndex].elapsed_seconds - records[b.startIndex].elapsed_seconds;
    return b.type === 'work' ? dur >= 15 : dur >= 12;
  });

  // Separate strides and work intervals
  const intervals = [];
  let intervalIdx = 1;

  for (const b of validBlocks) {
    const blockRecords = records.slice(b.startIndex, b.endIndex + 1);
    if (blockRecords.length === 0) continue;
    const startSec = blockRecords[0].elapsed_seconds;
    const endSec = blockRecords[blockRecords.length - 1].elapsed_seconds;
    const durSec = Math.max(1, endSec - startSec);

    const distM = (blockRecords[blockRecords.length - 1].distance_m || 0) - (blockRecords[0].distance_m || 0);
    const avgSpd = distM > 0 && durSec > 0 ? distM / durSec : (blockRecords.reduce((s, r) => s + (r.speed_mps || 0), 0) / blockRecords.length);
    const maxSpd = Math.max(...blockRecords.map(r => r.speed_mps || 0));
    const avgHr = Math.round(blockRecords.reduce((s, r) => s + (r.heart_rate || 0), 0) / blockRecords.length);
    const maxHr = Math.max(...blockRecords.map(r => r.heart_rate || 0));
    const avgCad = Math.round(blockRecords.reduce((s, r) => s + (r.cadence || 0), 0) / blockRecords.length);
    const maxCad = Math.max(...blockRecords.map(r => r.cadence || 0));

    let assignedType = b.type;
    // Detect stride: short active burst (15s - 50s) with fast speed or cadence
    if (b.type === 'work' && durSec <= 50 && (maxSpd >= 3.5 || maxCad >= 180)) {
      assignedType = 'stride';
    }

    intervals.push({
      intervalIndex: intervalIdx++,
      type: assignedType,
      startSeconds: startSec,
      durationSeconds: durSec,
      distanceMeters: Math.round(distM),
      avgSpeedMps: Number(avgSpd.toFixed(2)),
      avgPaceSecKm: avgSpd > 0 ? Math.round(1000 / avgSpd) : 0,
      avgHeartRate: avgHr,
      maxHeartRate: maxHr,
      avgCadence: avgCad
    });
  }

  return intervals;
}

const acts = db.prepare('SELECT id, name FROM activities ORDER BY start_time ASC').all();
for (const a of acts) {
  const records = db.prepare('SELECT elapsed_seconds, speed_mps, heart_rate, cadence, distance_m FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(a.id);
  const invs = detectIntervalsImproved(records);
  console.log(`\n[${a.id}] "${a.name}": Detected ${invs.length} blocks (${invs.filter(i=>i.type==='work').length} work, ${invs.filter(i=>i.type==='stride').length} stride, ${invs.filter(i=>i.type==='recovery').length} recovery)`);
  for (const i of invs) {
    if (i.type === 'work' || i.type === 'stride') {
      const pace = `${Math.floor(i.avgPaceSecKm/60)}:${String(i.avgPaceSecKm%60).padStart(2,'0')}`;
      console.log(`  #${i.intervalIndex} [${i.type}] ${(i.durationSeconds/60).toFixed(1)}m (${i.durationSeconds}s) | ${pace}/km | HR ${i.avgHeartRate}`);
    }
  }
}
