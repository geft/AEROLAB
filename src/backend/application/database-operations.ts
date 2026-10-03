import { AsyncLocalStorage } from 'node:async_hooks';

export type DatabaseOperation = 'import' | 'maintenance' | 'storage' | 'analysis' | 'weather';
interface Reservation { kind: DatabaseOperation }
let active: Reservation | undefined;
const owner = new AsyncLocalStorage<Reservation>();
const idleListeners = new Set<() => void>();

export class DatabaseBusyError extends Error {
  readonly code = 'DATABASE_BUSY';
  constructor() { super('Database is busy; retry after the current operation finishes'); }
}

export const currentDatabaseOperation = (): DatabaseOperation | null => active?.kind ?? null;
export const canWriteDatabase = (): boolean => !active || owner.getStore() === active;
export function assertDatabaseWritable(): void {
  if (!canWriteDatabase()) throw new DatabaseBusyError();
}

/** Reserve before any await. Workers retain their parent reservation until exit. */
export function reserveDatabaseOperation(kind: DatabaseOperation) {
  if (active) throw new DatabaseBusyError();
  const reservation = { kind };
  active = reservation;
  return {
    run<T>(work: () => T): T { return owner.run(reservation, work); },
    release(): void {
      if (active !== reservation) return;
      active = undefined;
      for (const listener of idleListeners) queueMicrotask(listener);
    }
  };
}

export function withDatabaseOperation<T>(kind: DatabaseOperation, work: () => T): T {
  if (active && owner.getStore() === active) return work();
  const lease = reserveDatabaseOperation(kind);
  try { return lease.run(work); } finally { lease.release(); }
}

export function onDatabaseIdle(listener: () => void): () => void {
  idleListeners.add(listener);
  return () => { idleListeners.delete(listener); };
}
