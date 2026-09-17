import Database from 'better-sqlite3';

export interface DeduplicateResult {
  pairsFound: number;
  activitiesPurged: number;
  purgedIds: string[];
}

/**
 * Detects and purges duplicate activities where the same physical run was imported
 * multiple times (e.g. once from Garmin CSV and once from native .FIT, or re-parsed).
 * Matches runs with start times within 60s and total distance within 150m.
 *
 * Keeps the run with richer metadata (custom title, more records), merges any missing
 * geolocation/weather/biomechanics, and cascades deletion of redundant rows.
 */
export function deduplicateRuns(db: Database.Database, logger?: (msg: string) => void): DeduplicateResult {
  const log = logger ?? (() => {});
  const result: DeduplicateResult = {
    pairsFound: 0,
    activitiesPurged: 0,
    purgedIds: []
  };

  try {
    const duplicates = db.prepare(`
      SELECT a1.id as id1, a1.name as name1, a1.start_time as time1, a1.distance_meters as dist1,
             a1.workout_lat as lat1, a1.workout_lon as lon1, a1.weather_condition as weather1,
             a2.id as id2, a2.name as name2, a2.start_time as time2, a2.distance_meters as dist2,
             a2.workout_lat as lat2, a2.workout_lon as lon2, a2.weather_condition as weather2
      FROM activities a1
      JOIN activities a2 ON a1.id < a2.id
      WHERE abs(strftime('%s', a1.start_time) - strftime('%s', a2.start_time)) <= 60
        AND abs(a1.distance_meters - a2.distance_meters) <= 150
    `).all() as any[];

    if (!duplicates || duplicates.length === 0) {
      return result;
    }

    result.pairsFound = duplicates.length;
    log(`Found ${duplicates.length} duplicate activity pairs. Resolving...`);

    const deleteSplits = db.prepare('DELETE FROM activity_splits WHERE activity_id = ?');
    const deleteIntervals = db.prepare('DELETE FROM activity_intervals WHERE activity_id = ?');
    const deleteRecords = db.prepare('DELETE FROM activity_records WHERE activity_id = ?');
    const deleteThresholds = db.prepare('DELETE FROM physiological_thresholds WHERE source_activity_id = ?');
    const deleteSummaries = db.prepare('DELETE FROM activity_coach_summaries WHERE activity_id = ?');
    const deleteActivity = db.prepare('DELETE FROM activities WHERE id = ?');

    const updateKeeperGeo = db.prepare('UPDATE activities SET workout_lat = ?, workout_lon = ? WHERE id = ?');
    const updateKeeperName = db.prepare('UPDATE activities SET name = ? WHERE id = ?');

    const purgedSet = new Set<string>();

    for (const pair of duplicates) {
      // If either has already been purged in an earlier pair, skip
      if (purgedSet.has(pair.id1) || purgedSet.has(pair.id2)) {
        continue;
      }

      // Determine record count for both
      const count1 = (db.prepare('SELECT count(*) as c FROM activity_records WHERE activity_id = ?').get(pair.id1) as any)?.c ?? 0;
      const count2 = (db.prepare('SELECT count(*) as c FROM activity_records WHERE activity_id = ?').get(pair.id2) as any)?.c ?? 0;

      const isDefaultName1 = !pair.name1 || pair.name1 === 'Singapore Running' || pair.name1 === 'Running';
      const isDefaultName2 = !pair.name2 || pair.name2 === 'Singapore Running' || pair.name2 === 'Running';

      let keeperId: string;
      let discardId: string;
      let bestName = pair.name1;

      // Decision logic:
      // 1. If one has a custom named title and the other has default, prefer custom title
      if (!isDefaultName1 && isDefaultName2) {
        keeperId = pair.id1;
        discardId = pair.id2;
        bestName = pair.name1;
      } else if (isDefaultName1 && !isDefaultName2) {
        keeperId = pair.id2;
        discardId = pair.id1;
        bestName = pair.name2;
      } else if (count1 !== count2) {
        // 2. Prefer the one with higher record count
        if (count1 >= count2) {
          keeperId = pair.id1;
          discardId = pair.id2;
          bestName = !isDefaultName1 ? pair.name1 : pair.name2;
        } else {
          keeperId = pair.id2;
          discardId = pair.id1;
          bestName = !isDefaultName2 ? pair.name2 : pair.name1;
        }
      } else {
        // 3. Fallback: prefer numeric Garmin CSV ID over synthetic garmin_* or fit_* ID
        const isNumeric1 = /^\d+$/.test(pair.id1);
        const isNumeric2 = /^\d+$/.test(pair.id2);
        if (isNumeric1 && !isNumeric2) {
          keeperId = pair.id1;
          discardId = pair.id2;
        } else {
          keeperId = pair.id2;
          discardId = pair.id1;
        }
      }

      // Transfer geolocation if discard has it and keeper doesn't
      const discardLat = discardId === pair.id1 ? pair.lat1 : pair.lat2;
      const discardLon = discardId === pair.id1 ? pair.lon1 : pair.lon2;
      const keeperLat = keeperId === pair.id1 ? pair.lat1 : pair.lat2;
      if (!keeperLat && discardLat) {
        updateKeeperGeo.run(discardLat, discardLon, keeperId);
      }

      // Ensure keeper has the best descriptive name
      if (bestName && bestName !== 'Singapore Running') {
        updateKeeperName.run(bestName, keeperId);
      }

      // Purge discard
      deleteSplits.run(discardId);
      deleteIntervals.run(discardId);
      deleteRecords.run(discardId);
      deleteThresholds.run(discardId);
      deleteSummaries.run(discardId);
      deleteActivity.run(discardId);

      purgedSet.add(discardId);
      result.activitiesPurged++;
      result.purgedIds.push(discardId);

      log(`Deduplicated: kept ${keeperId} ("${bestName}"), purged redundant ${discardId}`);
    }
  } catch (err: any) {
    log(`Deduplication error: ${err?.message || err}`);
  }

  return result;
}
