import { describe, it, expect } from 'vitest';
import {
  buildCoachContext,
  buildContextInsights,
  type HistoryRow
} from '../../src/backend/physiology/coach-history.js';

const CURRENT_START = '2026-09-20 07:00:00';

function historyRow(overrides: Partial<HistoryRow> & { id: string; start_time: string }): HistoryRow {
  return {
    run_type: 'easy_base',
    distance_meters: 10000,
    efficiency_factor: 1.25,
    aerobic_decoupling_pct: 3.0,
    avg_heart_rate: 140,
    steady_heart_rate: 139,
    avg_pace_sec_km: 320,
    steady_pace_sec_km: 318,
    training_load: 60,
    ...overrides
  };
}

const currentRun = {
  id: 'today',
  start_time: CURRENT_START,
  runType: 'easy_base',
  distanceKm: 12,
  efficiencyFactor: 1.32,
  decouplingPct: 1.4,
  steadyPaceSecKm: 318,
  steadyHr: 133
};

describe('Personal baseline comparison', () => {
  it('compares economy, pace-specific heart rate, drift rank, volume and load against prior runs', () => {
    const history: HistoryRow[] = [
      historyRow({ id: 'a', start_time: '2026-09-18 07:00:00', efficiency_factor: 1.22, aerobic_decoupling_pct: 3.4 }),
      historyRow({ id: 'b', start_time: '2026-09-16 07:00:00', efficiency_factor: 1.24, aerobic_decoupling_pct: 2.8 }),
      historyRow({ id: 'c', start_time: '2026-09-14 07:00:00', efficiency_factor: 1.26, aerobic_decoupling_pct: 3.9 }),
      historyRow({ id: 'd', start_time: '2026-09-12 07:00:00', efficiency_factor: 1.28, aerobic_decoupling_pct: 4.4 })
    ];

    const context = buildCoachContext(history, currentRun);

    expect(context.comparableRuns).toBe(4);
    expect(context.baselineEf).toBeCloseTo(1.25, 2);
    expect(context.efDeltaPct).toBeCloseTo(5.6, 1);
    // All four prior runs are within 20 s/km of the graded pace, so the pace-specific
    // heart-rate baseline is available and today cost less
    expect(context.hrAtPaceSamples).toBe(4);
    expect(context.baselineHrAtPace).toBe(139);
    expect(context.hrAtPaceDeltaBpm).toBe(-6);
    // 1.4% drift beats every prior run in the window
    expect(context.decouplingRank).toBe(1);
    expect(context.decouplingSamples).toBe(5);
    expect(context.decouplingBestPct).toBeCloseTo(1.4, 1);
    expect(context.isLongestRun).toBe(true);
    expect(context.longestDistanceKm).toBe(10);

    const insights = buildContextInsights(context);
    const find = (prefix: string) => insights.find(i => i.text.startsWith(prefix));
    expect(find('Personal Baseline:')?.text).toContain('real aerobic gain');
    expect(find('Pace-Specific Cost:')?.text).toContain('5:18/km');
    expect(find('Relative Standing:')?.text).toContain('most stable');
    expect(find('Volume Milestone:')).toBeDefined();

    // A real economy gain, a cheaper heart rate, a personal best and a new
    // distance ceiling are all strengths.
    expect(find('Personal Baseline:')?.tone).toBe('positive');
    expect(find('Pace-Specific Cost:')?.tone).toBe('positive');
    expect(find('Relative Standing:')?.tone).toBe('positive');
    expect(find('Volume Milestone:')?.tone).toBe('positive');
  });

  it('flags a ramping acute load and a fatigued economy against the athlete’s own baseline', () => {
    const history: HistoryRow[] = Array.from({ length: 8 }, (_, i) =>
      historyRow({
        id: `run-${i}`,
        start_time: `2026-09-${String(19 - i).padStart(2, '0')} 07:00:00`,
        efficiency_factor: 1.30,
        training_load: 90
      })
    );

    const context = buildCoachContext(history, {
      ...currentRun,
      efficiencyFactor: 1.22,
      steadyHr: 145
    });

    expect(context.efDeltaPct).toBeLessThan(0);
    expect(context.hrAtPaceDeltaBpm).toBeGreaterThan(0);
    expect(context.acwr).not.toBeNull();
    expect(context.acwr!).toBeGreaterThan(1.5);

    const insights = buildContextInsights(context);
    const find = (prefix: string) => insights.find(i => i.text.startsWith(prefix));
    expect(find('Training Load Context:')?.text).toContain('high-risk spike');
    expect(find('Personal Baseline:')?.text).toContain('below your 28-day median');
    expect(find('Pace-Specific Cost:')?.text).toContain('more');

    // A load spike needs fixing; a fatigued economy and a dearer heart rate are
    // things to watch rather than failures.
    expect(find('Training Load Context:')?.tone).toBe('negative');
    expect(find('Personal Baseline:')?.tone).toBe('caution');
    expect(find('Pace-Specific Cost:')?.tone).toBe('caution');
  });

  it('ignores other run families so a race never sets an easy-run baseline', () => {
    const history: HistoryRow[] = [
      historyRow({ id: 'race-1', start_time: '2026-09-15 07:00:00', run_type: 'race', efficiency_factor: 1.55 }),
      historyRow({ id: 'interval-1', start_time: '2026-09-13 07:00:00', run_type: 'intervals_vo2', efficiency_factor: 1.5 }),
      historyRow({ id: 'easy-1', start_time: '2026-09-11 07:00:00', efficiency_factor: 1.2 })
    ];

    const context = buildCoachContext(history, currentRun);
    expect(context.comparableRuns).toBe(1);
    expect(context.baselineEf).toBeNull(); // a single comparable run is not a baseline
    expect(context.efDeltaPct).toBeNull();
  });

  it('stays silent when there is not enough history to compare honestly', () => {
    expect(buildContextInsights(null)).toEqual([]);
    expect(buildContextInsights(buildCoachContext([], currentRun))).toEqual([]);
  });

  it('excludes activities outside the lookback window and the graded activity itself', () => {
    const history: HistoryRow[] = [
      historyRow({ id: 'old', start_time: '2026-01-05 07:00:00' }),
      historyRow({ id: 'today', start_time: CURRENT_START }),
      historyRow({ id: 'recent-1', start_time: '2026-09-17 07:00:00' }),
      historyRow({ id: 'recent-2', start_time: '2026-09-15 07:00:00' })
    ];

    const context = buildCoachContext(history, currentRun, { windowDays: 30 });
    expect(context.comparableRuns).toBe(2);
    expect(context.windowDays).toBe(30);
  });
});
