import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

/** Per-build preference kept outside the source checkout and installer. */
export function getDatabaseConfigPath(): string {
  const dataDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'aerolab')
    : path.join(os.homedir(), '.aerolab');
  const build = process.env.NODE_ENV === 'production' ? 'desktop' : 'development';
  return path.join(dataDir, `${build}-database-location.json`);
}

/** Resolve the database selected by this build. */
export function getDatabasePath(): string {
  const override = process.env.DATABASE_PATH?.trim();
  if (override) return override === ':memory:' ? override : path.resolve(override);

  // Automated tests must never open a user's configured workout database.
  if (process.env.NODE_ENV !== 'test') {
    const configPath = getDatabaseConfigPath();
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { databasePath?: unknown };
      if (typeof config.databasePath !== 'string' || !path.isAbsolute(config.databasePath)) {
        throw new Error(`Invalid databasePath in ${configPath}: expected an absolute path.`);
      }
      return path.normalize(config.databasePath);
    }
  }

  if (process.env.NODE_ENV === 'production') {
    return path.join(path.dirname(getDatabaseConfigPath()), 'runs.db');
  }
  return path.resolve(process.cwd(), 'data', 'runs.db');
}

/** Save this build's database location for its next start. */
export function saveDatabasePath(databasePath: string): string {
  if (!path.isAbsolute(databasePath) || databasePath === ':memory:') {
    throw new Error('Database path must be an absolute file path.');
  }
  const configPath = getDatabaseConfigPath();
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify({ databasePath: path.normalize(databasePath) }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, configPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  return configPath;
}
