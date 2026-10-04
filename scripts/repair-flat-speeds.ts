import { pruneBackupFiles } from '../src/backend/db/backup-retention.js';
/**
 * Repair Flat Speed Telemetry in runs.db
 *
 * Some Garmin watch firmware exports records where `enhanced_speed` (field 78)
 * recorded cumulative session average velocity rather than instantaneous speed.
 *
 * This script:
 * 1. Safely backs up `data/runs.db` to `data/backups/`.
 * 2. Scans all activities for flat or static speed records (< 0.15 m/s delta across the run).
 * 3. Reconstructs instantaneous velocity via a 5-second moving window over GPS `distance_m`.
 * 4. Updates `activity_records.speed_mps` in SQLite within a transaction.
 * 5. Runs `realignDatabase` to refresh interval detection and coach summaries.
 */

import fs from 'fs';
import path from 'path';
import { getDatabasePath } from '../src/backend/db/path.js';
import Database from 'better-sqlite3';
import { realignDatabase } from '../src/backend/db/realign.js';

const dbPath = getDatabasePath();

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { timeout: 30000 });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 1. Transactional online backup
const backupDir = path.resolve(path.dirname(dbPath), 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `runs-pre-speed-repair-${stamp}.db`);
db.prepare(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`).run();
console.log(`[backup] Safe backup written to: ${backupPath}`);
pruneBackupFiles(backupDir, backupPath);

// 2. Identify all activities with flat speed
const activitiesWithFlatSpeed = db.prepare(`
  SELECT a.id, a.start_time, a.name, a.distance_meters,
         COUNT(r.id) as rec_count,
         MIN(r.speed_mps) as min_spd,
         MAX(r.speed_mps) as max_spd,
         (MAX(r.speed_mps) - MIN(r.speed_mps)) as spd_range
  FROM activities a
  JOIN activity_records r ON r.activity_id = a.id
  WHERE a.distance_meters > 500
  GROUP BY a.id
  HAVING rec_count > 50 AND spd_range < 0.25
  ORDER BY a.start_time ASC
`).all() as any[];

console.log(`[scan] Found ${activitiesWithFlatSpeed.length} activities with flat speed telemetry.`);

if (activitiesWithFlatSpeed.length === 0) {
  console.log('[done] No activities need repair.');
  db.close();
  process.exit(0);
}

// 3. Reconstruct speeds and update activity_records
const getRecordsStmt = db.prepare(`
  SELECT id, elapsed_seconds, distance_m, speed_mps
  FROM activity_records
  WHERE activity_id = ?
  ORDER BY elapsed_seconds ASC
`);

const updateSpeedStmt = db.prepare(`
  UPDATE activity_records
  SET speed_mps = ?
  WHERE id = ?
`);

let totalRecordsRepaired = 0;
let activitiesRepaired = 0;

const repairTx = db.transaction((activities: any[]) => {
  for (const act of activities) {
    const rawRecords = getRecordsStmt.all(act.id) as any[];
    const validSpeeds = rawRecords.map(r => r.speed_mps).filter((s): s is number => s !== null && s > 0);
    const hasDistances = rawRecords.filter(r => r.distance_m !== null && r.distance_m > 0).length >= 20;

    let isBroken = false;
    if (validSpeeds.length >= 20) {
      const minS = Math.min(...validSpeeds);
      const maxS = Math.max(...validSpeeds);
      if (maxS - minS < 0.15 && minS > 1.0) {
        isBroken = true;
      }
    } else if (validSpeeds.length === 0 && hasDistances) {
      isBroken = true;
    }

    if (!isBroken || !hasDistances) continue;

    const windowSec = 5;
    let actRepairedCount = 0;

    for (let i = 0; i < rawRecords.length; i++) {
      const cur = rawRecords[i];
      if (cur.distance_m === null) continue;

      let prevIdx = i;
      while (prevIdx > 0 && cur.elapsed_seconds - rawRecords[prevIdx].elapsed_seconds < windowSec) {
        prevIdx--;
      }
      let nextIdx = i;
      while (nextIdx < rawRecords.length - 1 && rawRecords[nextIdx].elapsed_seconds - cur.elapsed_seconds < windowSec) {
        nextIdx++;
      }

      const prev = rawRecords[prevIdx];
      const next = rawRecords[nextIdx];
      if (prev.distance_m !== null && next.distance_m !== null) {
        const dt = next.elapsed_seconds - prev.elapsed_seconds;
        const dd = next.distance_m - prev.distance_m;
        if (dt >= 2 && dd >= 0) {
          const derived = dd / dt;
          const newSpeed = Number(Math.max(0, Math.min(9.0, derived)).toFixed(3));
          updateSpeedStmt.run(newSpeed, cur.id);
          actRepairedCount++;
        }
      }
    }

    if (actRepairedCount > 0) {
      totalRecordsRepaired += actRepairedCount;
      activitiesRepaired++;
    }
  }
});

console.log('[repair] Applying reconstructed instantaneous speeds to activity_records...');
repairTx(activitiesWithFlatSpeed);
console.log(`[repair] Successfully updated ${totalRecordsRepaired} records across ${activitiesRepaired} activities.`);

// 4. Re-align database (re-detect intervals, recalculate run types & coach summaries)
console.log('[realign] Re-aligning intervals and run classifications...');
const stats = realignDatabase(db, {
  logger: (msg) => console.log(`  [realign] ${msg}`)
});

db.close();

console.log('--- Summary ---');
console.log(`Activities Repaired: ${activitiesRepaired}`);
console.log(`Records Updated: ${totalRecordsRepaired}`);
console.log(`Intervals Rebuilt: ${stats.intervalsRebuilt}`);
console.log(`Run Type Changes: ${stats.runTypeChanges.length}`);
if (stats.runTypeChanges.length > 0) {
  console.log(JSON.stringify(stats.runTypeChanges.slice(0, 10), null, 2));
}
