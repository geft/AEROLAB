import { parentPort, workerData } from 'worker_threads';
import { closeDatabase, getDatabase } from '../db/client.js';
import { compactDatabase, measureStorageFootprint, shouldCompact } from '../db/compaction.js';
import { DERIVED_MIGRATIONS } from '../db/migrations.js';
import { recomputeProfileDerivedData } from '../physiology/profile-recompute.js';

const { databasePath, task, baselineChanged } = workerData as { databasePath: string; task: 'startup' | 'profile'; baselineChanged: boolean };
try {
  // Opening the connection runs only migrations whose checkpoints are absent.
  const db = getDatabase(databasePath);
  const completed = new Set((db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map(row => row.name));
  const missing = DERIVED_MIGRATIONS.filter(name => !completed.has(name));
  if (missing.length) throw new Error(`Incomplete migrations: ${missing.join(', ')}`);
  const syncedActivitiesCount = task === 'profile' ? recomputeProfileDerivedData(db, baselineChanged) : undefined;
  // Imports and reprocessing leave unused page space behind; compaction runs
  // here because it must not block the API's request path.
  let footprint = measureStorageFootprint(db);
  let reclaimedBytes: number | undefined;
  if (task === 'startup' && shouldCompact(footprint)) {
    parentPort?.postMessage({ status: 'running', compacting: true });
    reclaimedBytes = compactDatabase(db).reclaimedBytes;
    footprint = measureStorageFootprint(db);
  }
  parentPort?.postMessage({
    status: 'complete',
    completedMigrations: completed.size,
    syncedActivitiesCount,
    reclaimedBytes,
    databaseBytes: footprint.databaseBytes,
    reclaimableBytes: footprint.reclaimableBytes
  });
} catch (error) {
  parentPort?.postMessage({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
} finally {
  closeDatabase();
}
