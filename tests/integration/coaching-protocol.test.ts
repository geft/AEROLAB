import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/backend/db/client.js';
import { importParsedRun } from '../../src/backend/ingestion/importer.js';
import { getActivityCoachSummaryService } from '../../src/backend/services/activity-service.js';
import { workoutTrace } from '../fixtures/workout-trace.js';

describe('Persisted coaching protocol', () => {
  it('round-trips IDs and parameters through stored JSON and the coach API', () => {
    const db = openDatabase(':memory:');
    try {
      const run = workoutTrace([{ seconds: 2400, hr: 145 }], { id: 'protocol' });
      expect(importParsedRun(db, { ...run, fileHash: 'protocol' }, 'protocol.csv').status).toBe('imported');
      const summary = getActivityCoachSummaryService(db, 'protocol')!.coachSummary;
      expect(summary.messages?.headline.text).toBe(summary.headline);
      expect(summary.messages?.recommendation.text).toBe(summary.recommendation);
      expect(summary.scoreBreakdown).toEqual(expect.arrayContaining([
        expect.objectContaining({ categoryId: 'aerobic_intensity', findingId: expect.any(String) })
      ]));
      const stored = db.prepare('SELECT analysis_json FROM activity_coach_summaries WHERE activity_id=?').get('protocol') as { analysis_json: string };
      expect(JSON.parse(stored.analysis_json).messages).toEqual(summary.messages);

      // Old databases and exported snapshots contain presentation text only.
      db.prepare('UPDATE activity_coach_summaries SET analysis_json=? WHERE activity_id=?').run('{}', 'protocol');
      const legacy = getActivityCoachSummaryService(db, 'protocol')!.coachSummary;
      expect(legacy.messages).toBeUndefined();
      expect(legacy.headline).toBe(summary.headline);
      expect(legacy.recommendation).toBe(summary.recommendation);
    } finally { db.close(); }
  });
});
