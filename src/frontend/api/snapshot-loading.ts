import type {
  Activity, ActivityDetailResponse, BestEffortsResponse, ProfileResponse, ThresholdsResponse,
  TrainingLoadResponse, VolumeData, ProgressHistoryResponse
} from '../types/api.js';
import { decodeSnapshotArchive, SNAPSHOT_FILENAME, SnapshotDecodeError } from '../../shared/snapshot-codec.js';
import type { SnapshotArchive } from '../../shared/snapshot-codec.js';

export interface Snapshot {
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

export interface SnapshotLoadingProgress {
  stage: 'downloading' | 'preparing' | 'ready' | 'failed';
  percent?: number;
}

export class SnapshotLoadError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'SnapshotLoadError';
  }
}

export async function loadSnapshot(onProgress: (progress: SnapshotLoadingProgress) => void): Promise<SnapshotArchive> {
  onProgress({ stage: 'downloading' });
  // Cache Storage also works in the parsing worker and survives phone app restarts.
  // Storage can be unavailable or full; neither should prevent an online load.
  let cache: Cache | undefined;
  try {
    if (typeof caches !== 'undefined') cache = await caches.open('aerolab-snapshot-data-v2');
  } catch { /* Continue without persistent storage. */ }
  try {
    const snapshotUrl = `/${SNAPSHOT_FILENAME}`;
    const response = await fetch(snapshotUrl, { cache: 'no-cache' });
    const { data, bytes } = await parseSnapshot(response, onProgress);
    try {
      await cache?.put(snapshotUrl, new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch { /* Quota or privacy settings must not break a valid snapshot. */ }
    return data;
  } catch (error) {
    let cached: Response | undefined;
    try { cached = await cache?.match(`/${SNAPSHOT_FILENAME}`); } catch { /* Storage is optional. */ }
    if (cached) {
      try { return (await parseSnapshot(cached, onProgress)).data; } catch { /* Preserve the original load error. */ }
    }
    throw error;
  }
}

async function parseSnapshot(response: Response, onProgress: (progress: SnapshotLoadingProgress) => void): Promise<{ data: SnapshotArchive; bytes: Uint8Array }> {
  if (!response.ok) throw new SnapshotLoadError(response.status, 'ERR_SNAPSHOT_MISSING', 'Snapshot data is unavailable. Export and rebuild the viewer.');
  const encoding = response.headers.get('content-encoding');
  const length = Number(response.headers.get('content-length'));
  // Fetch streams decoded bytes; compressed Content-Length measures different bytes.
  const total = (!encoding || encoding === 'identity') && Number.isSafeInteger(length) && length > 0 ? length : null;
  let bytes: Uint8Array;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let previousPercent: number | undefined;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        chunks.push(value);
        const percent = total && loaded <= total ? Math.floor(loaded / total * 100) : undefined;
        if (percent !== previousPercent) {
          onProgress({ stage: 'downloading', percent });
          previousPercent = percent;
        }
      }
      bytes = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    } finally { reader.releaseLock(); }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  onProgress({ stage: 'preparing' });
  try {
    return { data: decodeSnapshotArchive(bytes), bytes };
  } catch (error) {
    if (error instanceof SnapshotDecodeError) throw new SnapshotLoadError(200, error.code, error.message);
    throw error;
  }
}

export type SnapshotWorkerRequest = { type: 'load' } | { type: 'read'; id: number; section: keyof Snapshot; key?: string };
export type SnapshotWorkerMessage =
  | { type: 'progress'; progress: SnapshotLoadingProgress }
  | { type: 'ready' }
  | { type: 'value'; id: number; value: unknown }
  | { type: 'error'; status: number; code: string; message: string };
