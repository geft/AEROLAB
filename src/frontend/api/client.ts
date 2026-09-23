import type { Activity, ActivityDetailResponse, DatabaseStatus, MaintenanceStatus } from '../types/api.js';

export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    throw new ApiRequestError(response.status, typeof error.code === 'string' ? error.code : 'ERR_API',
      typeof error.error === 'string' ? error.error : `HTTP ${response.status}`);
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
  return requestJson(`/api/activities/${encodeURIComponent(id)}`, { signal });
}

export function refreshActivityWeather(id: string): Promise<{ activity: Partial<Activity>; coachSummary?: ActivityDetailResponse['coachSummary'] }> {
  return requestJson(`/api/activities/${encodeURIComponent(id)}/weather/refresh`, { method: 'POST' });
}

export function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  return requestJson('/api/system/maintenance');
}
