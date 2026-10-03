import { readSnapshot } from './snapshot-reader.js';
export { getSnapshotLoadingProgress, subscribeSnapshotLoading } from './snapshot-reader.js';
import type {
  Activity, ActivityDetailResponse, BestEffortsResponse, ProfileResponse, ThresholdsResponse,
  TrainingLoadResponse, VolumeData, ProgressHistoryResponse, ActivityPatchInput
} from '../types/api.js';
export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function getSnapshotMetadata(): Promise<{ generatedAt: string }> {
  const generatedAt = await readSnapshot<string>('generatedAt');
  return { generatedAt };
}
export async function getProfile(): Promise<ProfileResponse> { return readSnapshot<ProfileResponse>('profile'); }
export async function listActivities(): Promise<{ activities: Activity[] }> { return { activities: await readSnapshot<Activity[]>('activities') }; }
export async function getActivityDetail(id: string): Promise<ActivityDetailResponse> {
  const detail = await readSnapshot<ActivityDetailResponse | undefined>('details', id);
  if (!detail) throw new ApiRequestError(404, 'ERR_ACTIVITY_NOT_FOUND', 'Activity not found in this snapshot.');
  return detail;
}
export async function getThresholds(): Promise<ThresholdsResponse> { return readSnapshot<ThresholdsResponse>('thresholdsByRunType', 'all'); }
export async function getProgressHistory(runType = 'all'): Promise<ProgressHistoryResponse> {
  return await readSnapshot<ProgressHistoryResponse | undefined>('progressByRunType', runType) ?? readSnapshot<ProgressHistoryResponse>('progressByRunType', 'all');
}
export async function getVolume(params: { period: string; month?: string; year?: string }): Promise<VolumeData> {
  const key = params.month ? `month:${params.month}` : params.year ? `year:${params.year}` : `${params.period}:current`;
  const data = await readSnapshot<VolumeData | undefined>('volume', key);
  if (!data) throw new ApiRequestError(400, 'ERR_SNAPSHOT_FILTER', `No exported volume data for ${key}.`);
  return data;
}
export async function getTrainingLoad(days = 30): Promise<TrainingLoadResponse> {
  const data = await readSnapshot<TrainingLoadResponse | undefined>('trainingLoadByDays', String(days));
  if (!data) throw new ApiRequestError(400, 'ERR_SNAPSHOT_FILTER', `No exported training load for ${days} days.`);
  return data;
}
export async function getBestEfforts(): Promise<BestEffortsResponse> { return readSnapshot<BestEffortsResponse>('bestEfforts'); }

function readOnly(): never { throw new ApiRequestError(405, 'ERR_SNAPSHOT_READ_ONLY', 'This snapshot is read-only.'); }
export const updateProfile = (_patch: unknown): never => readOnly();
export const patchActivity = (_id: string, _patch: ActivityPatchInput): never => readOnly();
export const refreshActivityWeather = (_id: string): never => readOnly();
export const uploadActivity = (_payload: unknown): never => readOnly();
export const uploadActivities = (_payload: unknown): never => readOnly();
export const startImportJob = (_totalFiles: number, _force: boolean): never => readOnly();
export const stageImportJob = (_jobId: string, _files: unknown): never => readOnly();
export const finishImportJob = (_jobId: string, _totalFiles: number): never => readOnly();
export const getImportJob = (_jobId: string): never => readOnly();
export const cancelImportJob = (_jobId: string): never => readOnly();
export const saveImportFolder = (_directory: string): never => readOnly();
export const selectImportFolder = (_title: string): never => readOnly();
export const scanImportFolder = (): never => readOnly();
export const restoreDatabase = (_file: Blob): never => readOnly();
export const restoreDatabaseSnapshot = (_filename: string): never => readOnly();
export const backupDatabase = (_directory?: string): never => readOnly();
export const deleteDatabaseSnapshot = (_filename: string): never => readOnly();
export const deploySnapshotToVercel = (_filename: string): never => readOnly();
export const getSnapshotDeploymentStatus = (_jobId: string): never => readOnly();
export const saveBackupSettings = (_settings: unknown): never => readOnly();
export const selectBackupFolder = (): never => readOnly();
export const openBackupFolder = (): never => readOnly();
export const getDatabaseStatus = (): never => readOnly();
export const chooseDatabaseLocation = (): never => readOnly();
export const setDatabaseLocation = (_path: string, _exists: boolean): never => readOnly();
export const getImportFolder = (): never => readOnly();
export const getMaintenanceStatus = (): never => readOnly();
export const getDevDiagnostics = (): never => readOnly();
export const simulateDevError = (_payload: unknown): never => readOnly();
