import { describe, expect, it } from 'vitest';
import { assertDatabaseWritable, canWriteDatabase, currentDatabaseOperation, reserveDatabaseOperation, withDatabaseOperation } from '../../src/backend/application/database-operations.js';

describe('local database writer ownership', () => {
  it.each(['import', 'maintenance', 'storage'] as const)('excludes service writes and other operations during %s', kind => {
    const lease = reserveDatabaseOperation(kind);
    try {
      expect(canWriteDatabase()).toBe(false);
      expect(() => assertDatabaseWritable()).toThrow('Database is busy');
      expect(() => reserveDatabaseOperation('storage')).toThrow('Database is busy');
    } finally { lease.release(); }
    expect(currentDatabaseOperation()).toBeNull();
  });

  it('retains async ownership across awaits and rejects unrelated writers', async () => {
    const lease = reserveDatabaseOperation('weather');
    try {
      await lease.run(async () => {
        await Promise.resolve();
        expect(canWriteDatabase()).toBe(true);
        expect(withDatabaseOperation('analysis', () => currentDatabaseOperation())).toBe('weather');
      });
      expect(canWriteDatabase()).toBe(false);
    } finally { lease.release(); }
  });

  it('releases on failure without letting an obsolete release cancel a new owner', () => {
    expect(() => withDatabaseOperation('analysis', () => { throw new Error('failed'); })).toThrow('failed');
    const old = reserveDatabaseOperation('storage');
    old.release();
    const next = reserveDatabaseOperation('import');
    try { old.release(); expect(currentDatabaseOperation()).toBe('import'); }
    finally { next.release(); }
  });
});
