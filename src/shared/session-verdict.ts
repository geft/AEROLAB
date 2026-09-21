/** Execution relative to the recorded session type, not fitness or a race result. */
export type SessionVerdict = 'on_track' | 'some_deviation' | 'off_target' | 'insufficient_evidence';

export function parseSessionVerdict(value: unknown): SessionVerdict {
  return value === 'on_track' || value === 'some_deviation' || value === 'off_target'
    ? value : 'insufficient_evidence';
}
