import { loadSnapshot } from './snapshot-loading.js';
import type { Snapshot, SnapshotLoadingProgress, SnapshotWorkerMessage } from './snapshot-loading.js';
import { readSnapshotSection } from '../../shared/snapshot-codec.js';
import type { SnapshotArchive } from '../../shared/snapshot-codec.js';

let progress: SnapshotLoadingProgress = { stage: 'downloading' };
const listeners = new Set<() => void>();
export const getSnapshotLoadingProgress = (): SnapshotLoadingProgress => progress;
export function subscribeSnapshotLoading(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function report(next: SnapshotLoadingProgress): void {
  progress = next;
  for (const listener of listeners) listener();
}

let ready: Promise<void> | undefined;
let worker: Worker | undefined;
let fallback: SnapshotArchive | undefined;
let failure: Error | undefined;
let requestId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function initialize(): Promise<void> {
  ready ??= new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => {
      failure = error;
      report({ stage: 'failed' });
      reject(error);
      for (const request of pending.values()) request.reject(error);
      pending.clear();
      worker?.terminate();
    };
    // Test/non-browser environments have no Worker. Browsers parse in the worker.
    if (typeof Worker === 'undefined') {
      void loadSnapshot(report).then(data => { fallback = data; report({ stage: 'ready' }); resolve(); }).catch(fail);
      return;
    }
    try {
      worker = new Worker(new URL('./snapshot-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<SnapshotWorkerMessage>) => {
        const message = event.data;
        if (message.type === 'progress') report(message.progress);
        else if (message.type === 'ready') { report({ stage: 'ready' }); resolve(); }
        else if (message.type === 'error') fail(Object.assign(new Error(message.message), { status: message.status, code: message.code }));
        else {
          pending.get(message.id)?.resolve(message.value);
          pending.delete(message.id);
        }
      };
      worker.onerror = () => fail(new Error('Snapshot worker failed'));
      worker.onmessageerror = () => fail(new Error('Snapshot worker response could not be read'));
      worker.postMessage({ type: 'load' });
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
  return ready;
}

export async function readSnapshot<T>(section: keyof Snapshot, key?: string): Promise<T> {
  await initialize();
  if (failure) throw failure;
  if (fallback) {
    return readSnapshotSection(fallback, section, key) as T;
  }
  return new Promise<T>((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve: value => resolve(value as T), reject });
    try { worker!.postMessage({ type: 'read', id, section, key }); }
    catch (error) { pending.delete(id); reject(error); }
  });
}
