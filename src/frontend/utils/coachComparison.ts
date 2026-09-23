import type { CoachContext } from '../types/api.js';

export type NotableRunComparison =
  | { kind: 'intensity'; startTime: string; previous: number; current: number }
  | { kind: 'pace'; startTime: string; secondsPerKm: number; direction: 'faster' | 'slower'; previousHr: number; currentHr: number }
  | { kind: 'heartRate'; startTime: string; bpm: number; direction: 'lower' | 'higher'; previousPace: number; currentPace: number };

/** One meaningful observation from the most recent comparable run. */
export function selectNotableRunComparison(
  context: Partial<Pick<CoachContext, 'lastSimilarRun' | 'currentAboveCeilingPct' | 'currentPaceSecKm' | 'currentHeartRate'>> | null | undefined
): NotableRunComparison | null {
  const previous = context?.lastSimilarRun;
  if (!previous) return null;

  const currentAbove = context?.currentAboveCeilingPct;
  const previousAbove = previous.aboveCeilingPct;
  if (currentAbove != null && previousAbove != null && Math.abs(currentAbove - previousAbove) >= 5) {
    return { kind: 'intensity', startTime: previous.startTime, previous: previousAbove, current: currentAbove };
  }

  const currentPace = context?.currentPaceSecKm;
  const currentHr = context?.currentHeartRate;
  if (currentPace == null || currentPace <= 0 || currentHr == null || currentHr <= 0) return null;
  const paceChange = currentPace - previous.paceSecKm;
  const hrChange = currentHr - previous.heartRate;

  if (Math.abs(paceChange) >= 10 && Math.abs(hrChange) <= 3) {
    return {
      kind: 'pace', startTime: previous.startTime,
      secondsPerKm: Math.round(Math.abs(paceChange)),
      direction: paceChange < 0 ? 'faster' : 'slower',
      previousHr: previous.heartRate, currentHr
    };
  }
  if (Math.abs(hrChange) >= 5 && Math.abs(paceChange) <= 10) {
    return {
      kind: 'heartRate', startTime: previous.startTime,
      bpm: Math.round(Math.abs(hrChange)),
      direction: hrChange < 0 ? 'lower' : 'higher',
      previousPace: previous.paceSecKm, currentPace
    };
  }
  return null;
}
