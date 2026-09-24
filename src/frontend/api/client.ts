import type {
  Activity,
  ActivityDetailResponse,
  ActivityPatchInput,
  ActivityPatchResponse,
  BackupResponse,
  BackupSettingsResponse,
  BestEffortsResponse,
  DatabaseStatus,
  MaintenanceStatus,
  ProgressHistoryResponse,
  ProfilePatchResponse,
  ProfileResponse,
  ProfileUpdateInput,
  RestoreDatabaseResponse,
  RestoreSnapshotResponse,
  SelectFolderResponse,
  ServerDiagnostics,
  ThresholdsResponse,
  TrainingLoadResponse,
  UploadResponse,
  VolumeData
} from '../types/api.js';

export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = options ? await fetch(url, options) : await fetch(url);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'ERR_NETWORK', 'Network request failed');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiRequestError(response.status, 'ERR_INVALID_RESPONSE', 'Invalid JSON response');
  }
  if (!response.ok) {
    const error = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    throw new ApiRequestError(response.status, typeof error.code === 'string' ? error.code : 'ERR_API',
      typeof error.error === 'string' ? error.error : `HTTP ${response.status}`);
  }
  if (body === null || typeof body !== 'object') {
    throw new ApiRequestError(response.status, 'ERR_INVALID_RESPONSE', 'Invalid JSON response');
  }
  return body as T;
}

export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  const status = await requestJson<DatabaseStatus>('/api/database/status');
  if (!status || typeof status.dbPath !== 'string') throw new ApiRequestError(200, 'ERR_INVALID_RESPONSE', 'Invalid database status');
  return status;
}

export function chooseDatabaseLocation(): Promise<{ databasePath: string | null; exists: boolean }> {
  return requestJson('/api/database/select-database', { method: 'POST' });
}

export function setDatabaseLocation(databasePath: string, expectedExists: boolean): Promise<{ databasePath: string; copied: boolean; restartRequired: boolean }> {
  return requestJson('/api/database/location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ databasePath, expectedExists })
  });
}

export function getActivityDetail(id: string, signal?: AbortSignal): Promise<ActivityDetailResponse> {
  return requestJson(`/api/activities/${encodeURIComponent(id)}`, signal ? { signal } : undefined);
}

export function listActivities(signal?: AbortSignal): Promise<{ activities: Activity[] }> {
  return requestJson('/api/activities', signal ? { signal } : undefined);
}

export function refreshActivityWeather(id: string): Promise<{ activity: Partial<Activity>; coachSummary?: ActivityDetailResponse['coachSummary'] }> {
  return requestJson(`/api/activities/${encodeURIComponent(id)}/weather/refresh`, { method: 'POST' });
}

export function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  return requestJson('/api/system/maintenance');
}

/** GET /api/profile — athlete baselines, effective thresholds and derived zones. */
export function getProfile(signal?: AbortSignal): Promise<ProfileResponse> {
  return requestJson('/api/profile', signal ? { signal } : undefined);
}

/** PATCH /api/profile — persist athlete baselines; the server recomputes derived data. */
export function updateProfile(patch: ProfileUpdateInput): Promise<ProfilePatchResponse> {
  return requestJson('/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}

/** GET /api/thresholds — current thresholds, zones, history and predictions. */
export function getThresholds(signal?: AbortSignal): Promise<ThresholdsResponse> {
  return requestJson('/api/thresholds', signal ? { signal } : undefined);
}

/** GET /api/activities/progress-history — monthly and yearly longitudinal progress. */
export function getProgressHistory(runType?: string, signal?: AbortSignal): Promise<ProgressHistoryResponse> {
  const query = runType ? `?run_type=${encodeURIComponent(runType)}` : '';
  return requestJson(`/api/activities/progress-history${query}`, signal ? { signal } : undefined);
}

/** GET /api/activities/volume — aggregated volume and heart-rate zones for one period. */
export function getVolume(params: { period: string; month?: string; year?: string }): Promise<VolumeData> {
  const query = new URLSearchParams({ period: params.period });
  if (params.month) query.set('month', params.month);
  if (params.year) query.set('year', params.year);
  return requestJson(`/api/activities/volume?${query.toString()}`);
}

/** GET /api/activities/training-load — acute/chronic load and the optimal tunnel. */
export function getTrainingLoad(days = 30): Promise<TrainingLoadResponse> {
  return requestJson(`/api/activities/training-load?days=${days}`);
}

/** GET /api/activities/best-efforts — benchmark personal bests. */
export function getBestEfforts(signal?: AbortSignal): Promise<BestEffortsResponse> {
  return requestJson('/api/activities/best-efforts', signal ? { signal } : undefined);
}

/** PATCH /api/activities/:id — inline title, run-type or tag edit. */
export function patchActivity(id: string, patch: ActivityPatchInput): Promise<ActivityPatchResponse> {
  return requestJson(`/api/activities/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
}

/** POST /api/ingest/upload — import a single FIT/CSV payload. */
export function uploadActivity(payload: { content: string; filename: string; force?: boolean; overwrite?: boolean }): Promise<UploadResponse> {
  return requestJson('/api/ingest/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

/** POST /api/database/restore — replace the active database from a raw .db file body. */
export function restoreDatabase(file: Blob): Promise<RestoreDatabaseResponse> {
  return requestJson('/api/database/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file
  });
}

/** POST /api/database/restore-snapshot — roll back to a named local snapshot. */
export function restoreDatabaseSnapshot(filename: string): Promise<RestoreSnapshotResponse> {
  return requestJson('/api/database/restore-snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename })
  });
}

/** POST /api/database/backup — write a snapshot, optionally to a chosen directory. */
export function backupDatabase(targetDirectory?: string): Promise<BackupResponse> {
  const directory = targetDirectory?.trim();
  return requestJson('/api/database/backup', {
    method: 'POST',
    ...(directory
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetDirectory: directory }) }
      : {})
  });
}

/** POST /api/database/settings — persist auto-backup preferences. */
export function saveBackupSettings(settings: { autoBackupEnabled?: boolean; backupDirectory?: string; backupIntervalDays?: number }): Promise<BackupSettingsResponse> {
  return requestJson('/api/database/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  });
}

/** POST /api/database/select-folder — open the native folder picker. */
export function selectBackupFolder(): Promise<SelectFolderResponse> {
  return requestJson('/api/database/select-folder', { method: 'POST' });
}

/** GET /api/dev/diagnostics — development-only server diagnostics. */
export function getDevDiagnostics(): Promise<ServerDiagnostics> {
  return requestJson('/api/dev/diagnostics');
}

/** POST /api/dev/test-error — development-only error-handling probe. */
export function simulateDevError(payload: { code: string; message: string }): Promise<{ error: string; code: string }> {
  return requestJson('/api/dev/test-error', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
