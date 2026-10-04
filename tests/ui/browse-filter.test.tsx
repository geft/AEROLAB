// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { doesActivityMatchTag, getActivityTags, type ActivitySummary } from '../../src/frontend/features/browse/selectors.js';
import { useBrowseSelection } from '../../src/frontend/features/browse/useBrowseSelection.js';
import { buildSessionTags } from '../../src/backend/ingestion/session-tags.js';

const activity = (id: string, run_type: string, tags: string[], date = '2026-09-12'): ActivitySummary => ({
  id, run_type, tags: JSON.stringify(tags), start_time: `${date} 07:00:00`, distance_meters: 5000
} as ActivitySummary);

afterEach(cleanup);

describe('Browse classification filters', () => {
  it('uses one primary classification despite contradictory saved tags', () => {
    const easy = activity('easy', 'easy_base', ['Easy Base', 'Tempo', 'Strides']);
    const tempo = activity('tempo', 'tempo', ['Easy Base', 'Tempo']);
    expect(doesActivityMatchTag(easy, 'Tempo')).toBe(false);
    expect(doesActivityMatchTag(easy, 'Easy Base')).toBe(true);
    expect(doesActivityMatchTag(easy, 'Strides')).toBe(true);
    expect(doesActivityMatchTag(tempo, 'Tempo')).toBe(true);
    expect(doesActivityMatchTag(tempo, 'Easy Base')).toBe(false);
    expect(getActivityTags(easy)).toEqual(['Easy Base', 'Strides']);
    expect(getActivityTags(tempo)).toEqual(['Tempo']);
  });

  it('matches classified tempo without tags and handles malformed legacy tags', () => {
    const tempo = activity('tempo', 'tempo', []);
    for (const tags of ['broken', '{}', '[null, 4, "Strides"]']) {
      expect(doesActivityMatchTag({ ...tempo, tags }, 'Tempo')).toBe(true);
      expect(() => getActivityTags({ ...tempo, tags })).not.toThrow();
    }
    expect(doesActivityMatchTag(activity('legacy', '', ['Tempo']), 'Tempo')).toBe(false);
    expect(getActivityTags(activity('long', 'long_run', ['Marathon Pace', 'Recovery']))).toEqual(['Long Run']);
  });

  it('keeps tempo filtering active when a calendar date is selected', () => {
    const activities = [activity('easy', 'easy_base', ['Easy Base', 'Tempo']),
      activity('tempo', 'tempo', ['Tempo']), activity('other-day', 'tempo', ['Tempo'], '2026-09-13')];
    const { result } = renderHook(() => useBrowseSelection(activities, 'tempo', vi.fn()));
    act(() => {
      result.current.setSelectedTagFilter('Tempo');
      result.current.setSelectedDate('2026-09-12');
    });
    expect(result.current.filteredActivities.map(a => a.id)).toEqual(['tempo']);
    expect(result.current.tagCounts.Tempo).toBe(2);
    expect(result.current.tagCounts['Easy Base']).toBe(1);
  });

  it('does not generate a tempo classification tag from elevated easy-run HR', () => {
    const records = [{ elapsedSeconds: 0, heartRate: 155 }, { elapsedSeconds: 1200, heartRate: 155 }];
    expect(buildSessionTags('easy_base', records as Parameters<typeof buildSessionTags>[1], [],
      { maxHr: 190, restingHr: 50, lt1Hr: 130, lt2Hr: 174 })).toEqual(['Easy Base']);
  });
});
