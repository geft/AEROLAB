import { getDatabase } from '../src/backend/db/client.js';
import { syncActivityCoachSummary } from '../src/backend/physiology/coach-summary.js';

function runBackfill() {
  const db = getDatabase();
  console.log('🔄 Backfilling Coach AI summaries and scoring breakdown...');

  // 1. Identify recovery runs: duration <= 48 min, distance <= 7.0km, avg HR <= 134 bpm, no intervals
  const potentialRecoveries = db.prepare(`
    SELECT a.id, a.start_time, a.duration_seconds, a.distance_meters, a.avg_heart_rate, a.tags, a.run_type
    FROM activities a
    WHERE a.duration_seconds <= 2880 AND a.distance_meters <= 7000 AND a.avg_heart_rate <= 134
  `).all() as any[];

  console.log(`Found ${potentialRecoveries.length} potential recovery runs.`);
  for (const act of potentialRecoveries) {
    const intervals = db.prepare("SELECT count(*) as count FROM activity_intervals WHERE activity_id = ? AND type = 'work'").get(act.id) as any;
    if (intervals.count === 0) {
      let tagsArr: string[] = [];
      try {
        tagsArr = act.tags ? JSON.parse(act.tags) : [];
      } catch {
        tagsArr = [];
      }
      if (!tagsArr.includes('Recovery')) {
        tagsArr.push('Recovery');
      }
      db.prepare("UPDATE activities SET run_type = 'recovery', tags = ? WHERE id = ?")
        .run(JSON.stringify(tagsArr), act.id);
      console.log(`  -> Reclassified as recovery: ${act.start_time} (${(act.duration_seconds / 60).toFixed(1)}m, ${act.avg_heart_rate} bpm)`);
    }
  }

  // 2. Re-evaluate coach summaries for all activities
  const allActs = db.prepare('SELECT id, start_time FROM activities ORDER BY start_time ASC').all() as any[];
  console.log(`Recalculating coach summaries across all ${allActs.length} activities...`);
  let synced = 0;
  for (const act of allActs) {
    if (syncActivityCoachSummary(db, act.id)) {
      synced++;
    }
  }
  console.log(`✅ Successfully synced ${synced} activity coach summaries with score breakdowns.`);
}

runBackfill();
