import { useSyncExternalStore } from 'react';

let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => revision;

/** One signal for imports, physiological edits, restore and completed maintenance. */
export function invalidateActivityData(): void {
  revision++;
  for (const listener of listeners) listener();
}
export const useActivityRevision = (): number => useSyncExternalStore(subscribe, snapshot, snapshot);
