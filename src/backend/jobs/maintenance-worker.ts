import { parentPort, workerData } from 'worker_threads';
import { closeDatabase, getDatabase } from '../db/client.js';
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
  parentPort?.postMessage({ status: 'complete', completedMigrations: completed.size, syncedActivitiesCount });
} catch (error) {
  parentPort?.postMessage({ status: 'failed', error: error instanceof Error ? error.message : String(error) });
} finally {
  closeDatabase();
}
