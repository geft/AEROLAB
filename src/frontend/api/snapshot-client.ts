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

const SCHEMA_VERSION = 1;
interface Snapshot {
  schemaVersion: number;
  generatedAt: string;
  activities: Activity[];
  details: Record<string, ActivityDetailResponse>;
  profile: ProfileResponse;
  bestEfforts: BestEffortsResponse;
  progressByRunType: Record<string, ProgressHistoryResponse>;
  thresholdsByRunType: Record<string, ThresholdsResponse>;
  volume: Record<string, VolumeData>;
  trainingLoadByDays: Record<string, TrainingLoadResponse>;
}
let snapshotPromise: Promise<Snapshot> | undefined;

async function getSnapshot(): Promise<Snapshot> {
  snapshotPromise ??= fetch('/snapshot.json', { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new ApiRequestError(response.status, 'ERR_SNAPSHOT_MISSING', 'Snapshot data is unavailable. Export and rebuild the viewer.');
    const data = await response.json() as Snapshot;
    if (data.schemaVersion !== SCHEMA_VERSION) throw new ApiRequestError(200, 'ERR_SNAPSHOT_VERSION', `This viewer cannot read snapshot schema ${data.schemaVersion}.`);
    if (!data.generatedAt || !Array.isArray(data.activities) || !data.details || !data.profile) {
      throw new ApiRequestError(200, 'ERR_SNAPSHOT_INVALID', 'Snapshot data is missing required sections. Export it again.');
    }
    return data;
  });
  return snapshotPromise;
}

export async function getSnapshotMetadata(): Promise<{ generatedAt: string }> {
  const { generatedAt } = await getSnapshot();
  return { generatedAt };
}
export async function getProfile(): Promise<ProfileResponse> { return (await getSnapshot()).profile; }
export async function listActivities(): Promise<{ activities: Activity[] }> { return { activities: (await getSnapshot()).activities }; }
export async function getActivityDetail(id: string): Promise<ActivityDetailResponse> {
  const detail = (await getSnapshot()).details[id];
  if (!detail) throw new ApiRequestError(404, 'ERR_ACTIVITY_NOT_FOUND', 'Activity not found in this snapshot.');
  return detail;
}
export async function getThresholds(): Promise<ThresholdsResponse> { return (await getSnapshot()).thresholdsByRunType.all; }
export async function getProgressHistory(runType = 'all'): Promise<ProgressHistoryResponse> {
  const snapshot = await getSnapshot();
  return snapshot.progressByRunType[runType] ?? snapshot.progressByRunType.all;
}
export async function getVolume(params: { period: string; month?: string; year?: string }): Promise<VolumeData> {
  const key = params.month ? `month:${params.month}` : params.year ? `year:${params.year}` : `${params.period}:current`;
  const data = (await getSnapshot()).volume[key];
  if (!data) throw new ApiRequestError(400, 'ERR_SNAPSHOT_FILTER', `No exported volume data for ${key}.`);
  return data;
}
export async function getTrainingLoad(days = 30): Promise<TrainingLoadResponse> {
  const data = (await getSnapshot()).trainingLoadByDays[String(days)];
  if (!data) throw new ApiRequestError(400, 'ERR_SNAPSHOT_FILTER', `No exported training load for ${days} days.`);
  return data;
}
export async function getBestEfforts(): Promise<BestEffortsResponse> { return (await getSnapshot()).bestEfforts; }

function readOnly(): never { throw new ApiRequestError(405, 'ERR_SNAPSHOT_READ_ONLY', 'This snapshot is read-only.'); }
export const updateProfile = (_patch: unknown): never => readOnly();
export const patchActivity = (_id: string, _patch: ActivityPatchInput): never => readOnly();
export const refreshActivityWeather = (_id: string): never => readOnly();
export const uploadActivity = (_payload: unknown): never => readOnly();
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
