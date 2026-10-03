import type {
  Activity, ActivityDetailResponse, BestEffortsResponse, ProfileResponse, ThresholdsResponse,
  TrainingLoadResponse, VolumeData, ProgressHistoryResponse
} from '../types/api.js';

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

export async function loadSnapshot(onProgress: (progress: SnapshotLoadingProgress) => void): Promise<Snapshot> {
  onProgress({ stage: 'downloading' });
  // Cache Storage also works in the parsing worker and survives phone app restarts.
  // Storage can be unavailable or full; neither should prevent an online load.
  let cache: Cache | undefined;
  try {
    if (typeof caches !== 'undefined') cache = await caches.open('aerolab-snapshot-data-v1');
  } catch { /* Continue without persistent storage. */ }
  try {
    const response = await fetch('/snapshot.json', { cache: 'no-cache' });
    const { data, text } = await parseSnapshot(response, onProgress);
    try {
      await cache?.put('/snapshot.json', new Response(text, { headers: { 'Content-Type': 'application/json' } }));
    } catch { /* Quota or privacy settings must not break a valid snapshot. */ }
    return data;
  } catch (error) {
    let cached: Response | undefined;
    try { cached = await cache?.match('/snapshot.json'); } catch { /* Storage is optional. */ }
    if (cached) {
      try { return (await parseSnapshot(cached, onProgress)).data; } catch { /* Preserve the original load error. */ }
    }
    throw error;
  }
}

async function parseSnapshot(response: Response, onProgress: (progress: SnapshotLoadingProgress) => void): Promise<{ data: Snapshot; text: string }> {
  if (!response.ok) throw new SnapshotLoadError(response.status, 'ERR_SNAPSHOT_MISSING', 'Snapshot data is unavailable. Export and rebuild the viewer.');
  const encoding = response.headers.get('content-encoding');
  const length = Number(response.headers.get('content-length'));
  // Fetch streams decoded bytes; compressed Content-Length measures different bytes.
  const total = (!encoding || encoding === 'identity') && Number.isSafeInteger(length) && length > 0 ? length : null;
  let text: string;
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let loaded = 0;
    let previousPercent: number | undefined;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        chunks.push(decoder.decode(value, { stream: true }));
        const percent = total && loaded <= total ? Math.floor(loaded / total * 100) : undefined;
        if (percent !== previousPercent) {
          onProgress({ stage: 'downloading', percent });
          previousPercent = percent;
        }
      }
      chunks.push(decoder.decode());
      text = chunks.join('');
    } finally { reader.releaseLock(); }
  } else {
    text = await response.text();
  }
  onProgress({ stage: 'preparing' });
  const data = JSON.parse(text) as Snapshot;
  if (data.schemaVersion !== 1) throw new SnapshotLoadError(200, 'ERR_SNAPSHOT_VERSION', `This viewer cannot read snapshot schema ${data.schemaVersion}.`);
  if (!data.generatedAt || !Array.isArray(data.activities) || !data.details || !data.profile) {
    throw new SnapshotLoadError(200, 'ERR_SNAPSHOT_INVALID', 'Snapshot data is missing required sections. Export it again.');
  }
  return { data, text };
}

export type SnapshotWorkerRequest = { type: 'load' } | { type: 'read'; id: number; section: keyof Snapshot; key?: string };
export type SnapshotWorkerMessage =
  | { type: 'progress'; progress: SnapshotLoadingProgress }
  | { type: 'ready' }
  | { type: 'value'; id: number; value: unknown }
  | { type: 'error'; status: number; code: string; message: string };
