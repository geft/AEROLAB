const Database = require('better-sqlite3');
const db = new Database('data/runs.db');

const activities = db.prepare('SELECT * FROM activities ORDER BY start_time ASC').all();
const profile = db.prepare("SELECT * FROM athlete_profile WHERE id = 'primary'").get();
const maxHr = profile.max_hr || 203;
const lt2Hr = profile.lt2_hr || 167;
const lt1Hr = profile.lt1_hr || 153;

function classifyRunDetailed(act, records) {
  const name = act.name || '';
  const distKm = act.distance_meters / 1000;
  const durMin = act.duration_seconds / 60;
  const avgHr = act.avg_heart_rate || 0;
  const actMaxHr = act.max_heart_rate || maxHr;

  // Check HR distribution
  let z1z2Count = 0, z3Count = 0, z4Count = 0, z5Count = 0, totalHr = 0;
  for (const r of records) {
    if (!r.heart_rate) continue;
    totalHr++;
    if (r.heart_rate < lt1Hr) z1z2Count++;
    else if (r.heart_rate < lt2Hr) z3Count++;
    else if (r.heart_rate < maxHr * 0.92) z4Count++;
    else z5Count++;
  }
  const z4Pct = totalHr > 0 ? (z4Count / totalHr) * 100 : 0;
  const z5Pct = totalHr > 0 ? (z5Count / totalHr) * 100 : 0;
  const z3Pct = totalHr > 0 ? (z3Count / totalHr) * 100 : 0;

  // Let's detect high-effort blocks (speed or HR)
  // High BPM is HR >= lt2Hr - 3 (or >= 82% of max HR)
  const highBpmThreshold = Math.min(lt2Hr - 3, actMaxHr * 0.82);

  // Group continuous high BPM segments
  const highBpmBlocks = [];
  let inBlock = false;
  let startSec = 0;
  let startIdx = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const isHigh = (r.heart_rate || 0) >= highBpmThreshold && (r.cadence || 0) >= 145;
    if (isHigh && !inBlock) {
      inBlock = true;
      startSec = r.elapsed_seconds;
      startIdx = i;
    } else if (!isHigh && inBlock) {
      inBlock = false;
      const dur = r.elapsed_seconds - startSec;
      if (dur >= 45) {
        const blockRecs = records.slice(startIdx, i);
        const bAvgHr = Math.round(blockRecs.reduce((s, x) => s + (x.heart_rate || 0), 0) / blockRecs.length);
        const bAvgSpd = blockRecs.reduce((s, x) => s + (x.speed_mps || 0), 0) / blockRecs.length;
        highBpmBlocks.push({ startSec, durationSec: dur, avgHr: bAvgHr, avgSpeed: bAvgSpd });
      }
    }
  }
  if (inBlock) {
    const r = records[records.length - 1];
    const dur = r.elapsed_seconds - startSec;
    if (dur >= 45) {
      const blockRecs = records.slice(startIdx);
      const bAvgHr = Math.round(blockRecs.reduce((s, x) => s + (x.heart_rate || 0), 0) / blockRecs.length);
      const bAvgSpd = blockRecs.reduce((s, x) => s + (x.speed_mps || 0), 0) / blockRecs.length;
      highBpmBlocks.push({ startSec, durationSec: dur, avgHr: bAvgHr, avgSpeed: bAvgSpd });
    }
  }

  // Check for strides (short bursts < 45s with high speed > 3.5m/s and cadence > 185)
  const strides = [];
  for (let i = 0; i < records.length - 10; i++) {
    if ((records[i].speed_mps || 0) >= 3.5 && (records[i].cadence || 0) >= 180) {
      let j = i;
      while (j < records.length && (records[j].speed_mps || 0) >= 3.0 && (records[j].cadence || 0) >= 170) {
        j++;
      }
      const dur = records[j - 1].elapsed_seconds - records[i].elapsed_seconds;
      if (dur >= 15 && dur <= 60) {
        strides.push({ start: records[i].elapsed_seconds, dur });
        i = j + 10;
      }
    }
  }

  console.log(`\n======================================================`);
  console.log(`[${act.id}] "${name}"`);
  console.log(`High BPM blocks (dur >= 45s, HR >= ${highBpmThreshold}): count = ${highBpmBlocks.length}`);
  for (const b of highBpmBlocks) {
    const pace = `${Math.floor(1000/b.avgSpeed/60)}:${String(Math.floor((1000/b.avgSpeed)%60)).padStart(2,'0')}`;
    console.log(`  - dur: ${(b.durationSec/60).toFixed(1)}m (${b.durationSec}s) | HR: ${b.avgHr} | pace: ${pace}/km`);
  }
  console.log(`Strides count: ${strides.length}`);
  console.log(`Z4%: ${z4Pct.toFixed(1)}%, Z5%: ${z5Pct.toFixed(1)}%, Z3%: ${z3Pct.toFixed(1)}%`);
}

for (const a of activities) {
  const records = db.prepare('SELECT elapsed_seconds, speed_mps, heart_rate, cadence FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(a.id);
  classifyRunDetailed(a, records);
}
