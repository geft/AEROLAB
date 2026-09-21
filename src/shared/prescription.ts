/**
 * Workout prescription hint (reps x work / recovery) inferred from detected
 * interval segments.
 *
 * This lives in shared code because two surfaces render the same number: the
 * run-detail table and the coach summary text written from the detector output.
 * Each used to round on its own rule and they disagreed (the table said 2:00 rec
 * where the detector said 2:15 for the same set). Rounding happens here and only
 * here.
 */

/** Any detected segment that can contribute to a prescription hint. */
export interface PrescriptionSegment {
  /** 'work' | 'recovery' | 'stride' — only 'work' reps set the prescription. */
  type: string;
  durationSeconds: number;
}

export interface WorkoutPrescription {
  repCount: number;
  workSeconds: number;
  recoverySeconds: number;
  label: string;
}

/**
 * Reps and recoveries both snap to 30s steps.
 *
 * Prescriptions are written on the half-minute (30s / 1:00 / 2:00 / 3:00), and a
 * measured recovery block runs 10-20s long because it also covers the deceleration
 * and re-acceleration either side of the lap boundary. A 2:13 jog block is a 2:00
 * prescription in practice, and a 3:00 prescription measures about 3:10. Snapping
 * recoveries on 15s instead reported "2:15 rec" for a session the athlete ran as
 * 4 x 4:00 with 2:00 recoveries.
 */
export const WORK_SNAP_SECONDS = 30;
export const RECOVERY_SNAP_SECONDS = 30;

/** Round a measured duration to the nearest standard step. */
export function snapSeconds(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0 || step <= 0) return 0;
  return Math.round(value / step) * step;
}

/** m:ss clock used by prescription labels (2:15, 15:00). */
export function formatPrescriptionClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Infer a prescription label from detected intervals (e.g. 3x15:00 / 3:00 rec).
 * Returns null when the work reps are too inconsistent to be a single set.
 */
export function inferWorkoutPrescription(segments: PrescriptionSegment[]): WorkoutPrescription | null {
  const workReps = segments.filter(s => s.type === 'work');
  if (workReps.length < 2) return null;

  const durations = workReps.map(s => s.durationSeconds).sort((a, b) => a - b);
  const medianWorkSec = durations[Math.floor(durations.length / 2)];
  const isConsistentWork = workReps.every(
    s => Math.abs(s.durationSeconds - medianWorkSec) <= Math.max(90, medianWorkSec * 0.2)
  );
  if (!isConsistentWork) return null;

  // Only breaks that sit *between* work reps describe the set. Requiring a work
  // rep on both sides keeps the warm-up walk and the post-set cool-down out — the
  // cool-down also directly follows a work rep, and letting a 23-minute one into
  // the median turned a 4 x 4:00 / 2:00 session into "2:30 rec".
  const recoveryDurations: number[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].type !== 'work' || segments[i + 1].type !== 'recovery') continue;
    if (segments.slice(i + 2).some(s => s.type === 'work')) {
      recoveryDurations.push(segments[i + 1].durationSeconds);
    }
  }
  const medianRecoverySec = recoveryDurations.length > 0
    ? [...recoveryDurations].sort((a, b) => a - b)[Math.floor(recoveryDurations.length / 2)]
    : 0;

  const workSeconds = snapSeconds(medianWorkSec, WORK_SNAP_SECONDS);
  const recoverySeconds = snapSeconds(medianRecoverySec, RECOVERY_SNAP_SECONDS);
  const label = `${workReps.length}x${formatPrescriptionClock(workSeconds)}` +
    (recoverySeconds > 0 ? ` / ${formatPrescriptionClock(recoverySeconds)} rec` : '');

  return { repCount: workReps.length, workSeconds, recoverySeconds, label };
}
