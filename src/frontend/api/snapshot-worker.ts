import { loadSnapshot, SnapshotLoadError } from './snapshot-loading.js';
import type { Snapshot, SnapshotWorkerMessage, SnapshotWorkerRequest } from './snapshot-loading.js';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SnapshotWorkerRequest>) => void) | null;
  postMessage(message: SnapshotWorkerMessage): void;
};
let snapshot: Snapshot | undefined;

scope.onmessage = event => {
  const request = event.data;
  if (request.type === 'load') {
    void loadSnapshot(progress => scope.postMessage({ type: 'progress', progress })).then(data => {
      // Keep full telemetry here; only requested dashboard sections cross to the UI.
      snapshot = data;
      scope.postMessage({ type: 'ready' });
    }).catch(error => {
      scope.postMessage({
        type: 'error', status: error instanceof SnapshotLoadError ? error.status : 0,
        code: error instanceof SnapshotLoadError ? error.code : 'ERR_SNAPSHOT_INVALID',
        message: error instanceof Error ? error.message : String(error)
      });
    });
  } else if (snapshot) {
    const section = snapshot[request.section];
    const value = request.key === undefined ? section : (section as Record<string, unknown>)?.[request.key];
    scope.postMessage({ type: 'value', id: request.id, value });
  }
};
