import { loadSnapshot, SnapshotLoadError } from './snapshot-loading.js';
import type { SnapshotWorkerMessage, SnapshotWorkerRequest } from './snapshot-loading.js';
import { readSnapshotSection } from '../../shared/snapshot-codec.js';
import type { SnapshotArchive } from '../../shared/snapshot-codec.js';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SnapshotWorkerRequest>) => void) | null;
  postMessage(message: SnapshotWorkerMessage): void;
};
let snapshot: SnapshotArchive | undefined;

scope.onmessage = event => {
  const request = event.data;
  if (request.type === 'load') {
    void loadSnapshot(progress => scope.postMessage({ type: 'progress', progress })).then(data => {
      // Keep telemetry columnar here; expand only the selected run's chart records.
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
    const value = readSnapshotSection(snapshot, request.section, request.key);
    scope.postMessage({ type: 'value', id: request.id, value });
  }
};
