import type Database from 'better-sqlite3';
import { withDatabaseOperation } from '../application/database-operations.js';
import { importParsedRuns } from '../ingestion/importer.js';
import { parseRunFit } from '../ingestion/fit-parser.js';
import { GARMIN_SYNC_BATCH_SIZE, type GarminImportStatus, type GarminSyncResponse, type GarminSyncResultItem } from '../../shared/garmin.js';
import {
  GarminApiError,
  downloadGarminActivity,
  garminKeyExpiryFromToken,
  isRunningGarminActivity,
  obtainGarminAccessToken,
  resetGarminTokenCache,
  searchGarminActivities,
  type GarminAccessToken,
  type GarminActivitySummary
} from './client.js';
import {
  clearStoredGarminCredentials,
  getGarminKeyStatus,
  recordDetectedGarminKeyExpiry,
  resolveGarminCredentials
} from './credentials.js';

const BACKFILL_PREFERENCE = 'garminBackfillBefore';

interface SyncCandidate {
  activity: GarminActivitySummary;
  direction: 'newer' | 'older';
  /** Local wall-clock start, used for ordering and the backfill cursor. */
  time: string;
}

export interface GarminBatchPlan {
  candidates: SyncCandidate[];
  hasMoreNewer: boolean;
  hasMoreOlder: boolean;
}

function activityTime(activity: GarminActivitySummary): string | null {
  return activity.startTimeLocal ?? activity.startTimeGmt;
}

function isSyncableActivity(activity: GarminActivitySummary): boolean {
  return isRunningGarminActivity(activity) && activityTime(activity) !== null;
}

/**
 * Choose the next contiguous slice of Garmin history: new runs after the newest
 * local activity, then older runs immediately before the backfill cursor.
 * Newer runs are taken oldest-first so a large gap fills without holes.
 */
export function planGarminBatch(input: {
  newer: GarminActivitySummary[];
  older: GarminActivitySummary[];
  latestLocal: string | null;
  oldestLocal: string | null;
  backfillBefore: string | null;
  limit: number;
}): GarminBatchPlan {
  const limit = Math.max(1, Math.floor(input.limit));
  const newerSorted = input.newer
    .filter(activity => isSyncableActivity(activity) &&
      (!input.latestLocal || activityTime(activity)! > input.latestLocal))
    .sort((a, b) => activityTime(a)!.localeCompare(activityTime(b)!));
  const takenNewer = newerSorted.slice(0, limit);

  const boundary = input.backfillBefore ?? input.oldestLocal;
  const olderSorted = input.older
    .filter(activity => isSyncableActivity(activity) &&
      (!boundary || activityTime(activity)! < boundary))
    .sort((a, b) => activityTime(b)!.localeCompare(activityTime(a)!));
  const takenOlder = olderSorted.slice(0, Math.max(0, limit - takenNewer.length));

  const candidates: SyncCandidate[] = [
    ...takenNewer.map(activity => ({ activity, direction: 'newer' as const, time: activityTime(activity)! })),
    ...takenOlder.map(activity => ({ activity, direction: 'older' as const, time: activityTime(activity)! }))
  ];

  return {
    candidates,
    hasMoreNewer: newerSorted.length > takenNewer.length,
    hasMoreOlder: olderSorted.length > takenOlder.length
  };
}

function readPreferences(db: Database.Database): Record<string, unknown> {
  try {
    const row = db.prepare("SELECT preferences_json FROM athlete_profile WHERE id = 'primary'")
      .get() as { preferences_json?: string } | undefined;
    if (!row?.preferences_json) return {};
    const parsed = JSON.parse(row.preferences_json) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readBackfillCursor(db: Database.Database): string | null {
  const value = readPreferences(db)[BACKFILL_PREFERENCE];
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value : null;
}

function writeBackfillCursor(db: Database.Database, value: string): void {
  const preferences = readPreferences(db);
  preferences[BACKFILL_PREFERENCE] = value;
  db.prepare("INSERT OR IGNORE INTO athlete_profile (id) VALUES ('primary')").run();
  db.prepare("UPDATE athlete_profile SET preferences_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'primary'")
    .run(JSON.stringify(preferences));
}

function localRange(db: Database.Database): { newest: string | null; oldest: string | null } {
  const row = db.prepare('SELECT MAX(start_time) AS newest, MIN(start_time) AS oldest FROM activities')
    .get() as { newest?: string | null; oldest?: string | null } | undefined;
  return { newest: row?.newest ?? null, oldest: row?.oldest ?? null };
}

function dateOnly(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function importStatus(result: { status: 'imported' | 'skipped_duplicate' | 'skipped_non_running' | 'error' }): GarminImportStatus {
  return result.status;
}

function keyStatusAfter(token: GarminAccessToken): ReturnType<typeof getGarminKeyStatus> {
  // A token minted with a shorter-than-24-hour lifetime proves the key itself
  // expires sooner. Using iat avoids mistaking a reused cached token for that.
  const detectedExpiry = garminKeyExpiryFromToken(token);
  if (detectedExpiry) recordDetectedGarminKeyExpiry(detectedExpiry);
  return getGarminKeyStatus();
}

function isInvalidKeyError(error: unknown): boolean {
  return error instanceof GarminApiError && error.code === 'GARMIN_KEY_INVALID';
}

/** No recorded file behind the activity, e.g. a manual entry. Never retryable. */
function isMissingFileError(error: unknown): boolean {
  return error instanceof GarminApiError && error.code === 'GARMIN_NO_FILE';
}

/** A key Garmin rejects can never work again; stop offering it locally. */
function forgetRejectedKey(source: 'stored' | 'environment'): void {
  resetGarminTokenCache();
  if (source === 'stored') clearStoredGarminCredentials();
}

export async function syncGarmin(
  db: Database.Database,
  options: { limit?: number } = {}
): Promise<GarminSyncResponse> {
  const limit = Math.min(GARMIN_SYNC_BATCH_SIZE, Math.max(1, Math.floor(options.limit ?? GARMIN_SYNC_BATCH_SIZE)));
  const credentials = resolveGarminCredentials();
  if (!credentials) {
    throw new GarminApiError('GARMIN_KEY_MISSING', 'Add a Garmin Personal API key in Settings first.', 400);
  }

  let token: GarminAccessToken;
  try {
    token = await obtainGarminAccessToken(credentials.apiKey);
  } catch (error) {
    if (isInvalidKeyError(error)) forgetRejectedKey(credentials.source);
    throw error;
  }

  const key = keyStatusAfter(token);
  const { newest, oldest } = localRange(db);
  const backfillBefore = readBackfillCursor(db);
  const searchLimit = limit + 1;

  let newer: GarminActivitySummary[];
  let older: GarminActivitySummary[];
  try {
    newer = await searchGarminActivities(token, newest
      ? { startDate: dateOnly(newest), limit: searchLimit }
      : { limit: searchLimit });
    older = oldest
      ? await searchGarminActivities(token, { endDate: dateOnly(backfillBefore ?? oldest), limit: searchLimit })
      : [];
  } catch (error) {
    if (isInvalidKeyError(error)) forgetRejectedKey(credentials.source);
    throw error;
  }

  const plan = planGarminBatch({ newer, older, latestLocal: newest, oldestLocal: oldest, backfillBefore, limit });

  const results: GarminSyncResultItem[] = [];
  const parsedFiles: Array<{ filename: string; candidate: SyncCandidate; parsed: NonNullable<ReturnType<typeof parseRunFit>> }> = [];
  const settledOlder = new Set<string>();

  const downloads = await Promise.allSettled(plan.candidates.map(async candidate => ({
    candidate,
    buffer: await downloadGarminActivity(token, candidate.activity.activityId)
  })));
  const rejectedKey = downloads.some(download =>
    download.status === 'rejected' && isInvalidKeyError(download.reason));
  if (rejectedKey) {
    forgetRejectedKey(credentials.source);
    throw new GarminApiError(
      'GARMIN_KEY_INVALID',
      'Garmin rejected the Personal API key. The key may have expired or been deleted.',
      401
    );
  }

  downloads.forEach((download, index) => {
    const candidate = plan.candidates[index];
    const filename = `garmin-${candidate.activity.activityId}.zip`;
    if (download.status === 'rejected') {
      if (isMissingFileError(download.reason)) {
        // A manual activity has nothing to import. Settle it so the backfill
        // cursor can move past it instead of retrying the same dead entry on
        // every sync and blocking everything older than it.
        if (candidate.direction === 'older') settledOlder.add(candidate.activity.activityId);
        results.push({
          filename,
          activityName: candidate.activity.activityName,
          date: candidate.time,
          status: 'skipped_no_file'
        });
        return;
      }
      results.push({
        filename,
        activityName: candidate.activity.activityName,
        date: candidate.time,
        status: 'error',
        error: download.reason instanceof Error ? download.reason.message : String(download.reason)
      });
      return;
    }
    try {
      const parsed = parseRunFit(download.value.buffer, filename);
      if (!parsed) {
        if (candidate.direction === 'older') settledOlder.add(candidate.activity.activityId);
        results.push({
          filename,
          activityName: candidate.activity.activityName,
          date: candidate.time,
          status: 'skipped_non_running'
        });
        return;
      }
      parsedFiles.push({ filename, candidate, parsed });
    } catch (error) {
      results.push({
        filename,
        activityName: candidate.activity.activityName,
        date: candidate.time,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  if (parsedFiles.length) {
    const imported = withDatabaseOperation('import', () => importParsedRuns(
      db,
      parsedFiles.map(file => ({ filename: file.filename, parsed: file.parsed }))
    ));
    parsedFiles.forEach((file, index) => {
      const result = imported[index];
      if (result.status !== 'error' && file.candidate.direction === 'older') {
        settledOlder.add(file.candidate.activity.activityId);
      }
      results.push({
        filename: file.filename,
        activityName: file.parsed.metadata.name,
        date: file.parsed.metadata.date,
        status: importStatus(result),
        activityId: result.activityId,
        error: result.error
      });
    });
  }

  // Advance the backfill cursor only across a contiguous settled prefix. A
  // failed download keeps the cursor above it so the next sync retries that
  // activity instead of skipping past it.
  const olderCandidates = plan.candidates.filter(candidate => candidate.direction === 'older');
  let nextCursor: string | null = null;
  for (const candidate of olderCandidates) {
    if (!settledOlder.has(candidate.activity.activityId)) break;
    nextCursor = candidate.time;
  }
  if (nextCursor) {
    writeBackfillCursor(db, nextCursor);
  }

  return {
    key,
    batchLimit: limit,
    newerFound: plan.candidates.filter(candidate => candidate.direction === 'newer').length,
    olderFound: plan.candidates.filter(candidate => candidate.direction === 'older').length,
    imported: results.filter(result => result.status === 'imported').length,
    duplicates: results.filter(result => result.status === 'skipped_duplicate').length,
    nonRunning: results.filter(result => result.status === 'skipped_non_running').length,
    noFile: results.filter(result => result.status === 'skipped_no_file').length,
    errors: results.filter(result => result.status === 'error').length,
    hasMoreNewer: plan.hasMoreNewer,
    hasMoreOlder: plan.hasMoreOlder,
    results
  };
}
