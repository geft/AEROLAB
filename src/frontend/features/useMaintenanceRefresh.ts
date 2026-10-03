import { useEffect } from 'react';
import { getMaintenanceStatus } from '../api/client.js';
import { useActivityRevision } from './activity-revision.js';

/** Observe startup/profile work only while it is active; completion emits the API revision. */
export function useMaintenanceRefresh(enabled: boolean): void {
  const revision = useActivityRevision();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const status = await getMaintenanceStatus();
        if (!cancelled && status.status === 'running') timer = setTimeout(() => { void poll(); }, 1000);
      } catch { /* Maintenance observation is optional while the local API is unavailable. */ }
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled, revision]);
}
