import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import type { UpdatePreferences } from '../../shared/update.js';

/**
 * Update preferences are user-level app settings, not workout data, so they live
 * in a small JSON file beside the database-location override. Keeping them out
 * of SQLite means an update check still works while a migration or import holds
 * the database.
 */
export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = { autoCheck: true };

function preferencesDir(): string {
  return process.env.APPDATA
    ? path.join(process.env.APPDATA, 'aerolab')
    : path.join(os.homedir(), '.aerolab');
}

/** Per-build file: the packaged app never shares settings with a dev checkout. */
export function getUpdatePreferencesPath(): string {
  const build = process.env.NODE_ENV === 'production' ? 'desktop' : 'development';
  return path.join(preferencesDir(), `${build}-update-preferences.json`);
}

export function readUpdatePreferences(): UpdatePreferences {
  try {
    const raw = fs.readFileSync(getUpdatePreferencesPath(), 'utf8');
    const parsed = JSON.parse(raw) as { autoCheck?: unknown };
    if (typeof parsed.autoCheck === 'boolean') return { autoCheck: parsed.autoCheck };
  } catch { /* intentionally ignored: missing or malformed files fall back to defaults */ }
  return { ...DEFAULT_UPDATE_PREFERENCES };
}

export function saveUpdatePreferences(patch: Partial<UpdatePreferences>): UpdatePreferences {
  const current = readUpdatePreferences();
  const updated: UpdatePreferences = {
    ...current,
    ...(typeof patch.autoCheck === 'boolean' ? { autoCheck: patch.autoCheck } : {})
  };
  const preferencesPath = getUpdatePreferencesPath();
  const temporaryPath = `${preferencesPath}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, preferencesPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  return updated;
}

/** Windows update staging area; the packaged launcher reads the pending marker. */
export function getUpdateStagingDir(): string {
  const override = process.env.AEROLAB_UPDATE_DIR?.trim();
  if (override && path.isAbsolute(override)) return override;
  return path.join(preferencesDir(), 'updates');
}

export function getPendingUpdatePath(): string {
  return path.join(getUpdateStagingDir(), 'pending-update.json');
}
