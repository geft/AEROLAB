import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { updateActivityService } from '../../src/backend/services/activity-service.js';

describe('activity service input boundary', () => {
  it('rejects unsupported tags before touching the database', () => {
    const db = new Database(':memory:');
    try {
      expect(updateActivityService(db, 'run-1', { tags: ['Unexpected'] })).toMatchObject({
        ok: false,
        status: 400,
        code: 'ERR_INVALID_TAGS'
      });
    } finally {
      db.close();
    }
  });

  it('rejects an empty patch with a stable code', () => {
    const db = new Database(':memory:');
    try {
      expect(updateActivityService(db, 'run-1', {})).toMatchObject({
        ok: false,
        status: 400,
        code: 'ERR_NO_FIELDS_TO_UPDATE'
      });
    } finally {
      db.close();
    }
  });
});
