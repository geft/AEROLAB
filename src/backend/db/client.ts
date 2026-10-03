import { runSchemaMigrations, runDerivedMigrations } from './migrations/registry.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { getDatabasePath } from './path.js';
import { createMigrationRunner } from './migrations.js';

const currentDir = typeof __dirname !== 'undefined'
  ? __dirname
  : (typeof import.meta !== 'undefined' && import.meta.url ? path.dirname(fileURLToPath(import.meta.url)) : process.cwd());

let dbInstance: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (dbInstance && !dbPath) {
    return dbInstance;
  }

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch { /* best-effort cleanup: safe to ignore */ }
    dbInstance = null;
  }

  const targetPath = dbPath || getDatabasePath();
  dbInstance = openDatabase(targetPath);
  return dbInstance;
}

// Open an independent connection so restore validation never closes the live database.
export function openDatabase(targetPath: string, validateSchema = false): Database.Database {

  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(targetPath);
  try {
    initializeDatabase(db, validateSchema);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function initializeDatabase(db: Database.Database, validateSchema: boolean): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema
  const candidateSchemaPaths = [
    path.resolve(currentDir, 'schema.sql'),
    path.resolve(currentDir, 'db', 'schema.sql'),
    path.resolve(currentDir, 'src', 'backend', 'db', 'schema.sql'),
    path.resolve(process.cwd(), 'src', 'backend', 'db', 'schema.sql'),
    path.resolve(process.cwd(), 'dist-backend', 'schema.sql')
  ];
  const schemaPath = candidateSchemaPaths.find(p => fs.existsSync(p));
  if (schemaPath) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
  }
  const migrations = createMigrationRunner(db);
  const deferDerivedMigrations = process.env.AEROLAB_DEFER_MIGRATIONS === '1';

  runSchemaMigrations(db, migrations);

  // A fresh profile contains no personal measurements or training history.
  if (!db.prepare("SELECT id FROM athlete_profile WHERE id = 'primary'").get()) {
    // Explicit nulls also override personal DEFAULT clauses in older schemas.
    db.prepare(`INSERT INTO athlete_profile (id, age, dob, height_cm, weight_kg, resting_hr, max_hr,
      lt1_hr, lt2_hr, lt1_min_hr, lt1_max_hr, z3_start_hr, z4_start_hr, vo2_max,
      goal_marathon, upcoming_benchmark, pb_5k, pb_hm, shoe_threshold, shoe_easy, shoe_retired,
      location, favorite_route, schedule_json, preferences_json, is_max_hr_estimated)
      VALUES ('primary', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}', 1)`).run();
  }

  if (!deferDerivedMigrations) runDerivedMigrations(db, migrations);

  // Retire the Google Drive integration: drop any stored OAuth tokens left behind
  // so refresh tokens do not linger on disk once the feature is gone.
  try {
    db.exec('DROP TABLE IF EXISTS google_auth');
    db.exec('DROP TABLE IF EXISTS google_tokens');
  } catch (err: any) {
    logger.debug('DB', 'Legacy auth table cleanup skipped', { error: err?.message || String(err) });
  }

  // Periodic SQLite query planner & index optimization
  try {
    db.pragma('optimize');
  } catch (err: any) {
    logger.debug('DB', 'SQLite optimize() skipped', { error: err?.message || String(err) });
  }

  if (validateSchema) {
    if (!schemaPath) throw new Error('Database schema file is unavailable');
    const reference = new Database(':memory:');
    try {
      reference.exec(fs.readFileSync(schemaPath, 'utf8'));
      const tables = reference.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
      for (const { name } of tables) {
        const columns = reference.prepare('SELECT name FROM pragma_table_info(?)').all(name) as Array<{ name: string }>;
        const actual = new Set((db.prepare('SELECT name FROM pragma_table_info(?)').all(name) as Array<{ name: string }>).map(c => c.name));
        if (columns.some(c => !actual.has(c.name))) throw new Error(`Incompatible database schema: ${name}`);
      }
      if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Database contains invalid foreign key references');
    } finally {
      reference.close();
    }
  }
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
