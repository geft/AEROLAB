import { describe, it, expect } from 'vitest';
import {
  RECOVERY_SNAP_SECONDS,
  WORK_SNAP_SECONDS,
  formatPrescriptionClock,
  inferWorkoutPrescription,
  snapSeconds
} from '../../src/shared/prescription';

const work = (durationSeconds: number) => ({ type: 'work', durationSeconds });
const recovery = (durationSeconds: number) => ({ type: 'recovery', durationSeconds });
const stride = (durationSeconds: number) => ({ type: 'stride', durationSeconds });

describe('Workout prescription (shared by the run table and the coach summary)', () => {
  it('rounds a measured recovery back to the prescribed half-minute', () => {
    // Real Aug-31 VO2 set: Garmin logged 4 x 4:00 with 2:00 recoveries, and the
    // telemetry jog blocks measure 2:15 / 2:10 / 2:13 because they also cover the
    // deceleration and re-acceleration around each lap boundary. The hint has to
    // read like the prescription (2:00), not the jog block (2:15).
    const prescription = inferWorkoutPrescription([
      work(244), recovery(135), work(244), recovery(130), work(243), recovery(133), work(249)
    ]);
    expect(prescription).toMatchObject({ repCount: 4, workSeconds: 240, recoverySeconds: 120 });
    expect(prescription!.label).toBe('4x4:00 / 2:00 rec');
  });

  it('does not let the cool-down stand in for a set recovery', () => {
    // The cool-down directly follows the last rep too. Including it put a 23-minute
    // segment into the median and reported "2:30 rec" for a 2:00 set.
    const prescription = inferWorkoutPrescription([
      work(244), recovery(135), work(244), recovery(130),
      work(243), recovery(133), work(249), recovery(1381)
    ]);
    expect(prescription).toMatchObject({ repCount: 4, recoverySeconds: 120 });
    expect(prescription!.label).toBe('4x4:00 / 2:00 rec');
  });

  it('reads a genuine 3:00 recovery as 3:00 even though the jog block measures longer', () => {
    // The same athlete's revised session: 3:00 programmed, ~3:10 of slow jogging.
    const prescription = inferWorkoutPrescription([
      work(240), recovery(192), work(240), recovery(188), work(240), recovery(190), work(240)
    ]);
    expect(prescription!.label).toBe('4x4:00 / 3:00 rec');
  });

  it('ignores warm-up and cool-down segments when reporting the recovery', () => {
    // The real Aug-31 segment list: warm-up strides with their own short jog
    // recoveries in front, and a 23-minute cool-down directly after the last rep.
    // Both used to feed the median and misreport the set's recovery.
    const prescription = inferWorkoutPrescription([
      recovery(1108), stride(10), recovery(105), stride(10), recovery(108),
      work(244), recovery(135), work(244), recovery(130), work(243), recovery(133), work(249),
      recovery(1381)
    ]);
    expect(prescription!.recoverySeconds).toBe(120);
    expect(prescription!.label).toBe('4x4:00 / 2:00 rec');
  });

  it('omits the recovery when no work rep is followed by one', () => {
    const prescription = inferWorkoutPrescription([work(900), stride(12), work(900)]);
    expect(prescription).toMatchObject({ repCount: 2, workSeconds: 900, recoverySeconds: 0 });
    expect(prescription!.label).toBe('2x15:00');
  });

  it('returns null unless the work reps are one consistent set', () => {
    expect(inferWorkoutPrescription([work(60), recovery(120), work(900)])).toBeNull();
    expect(inferWorkoutPrescription([work(900)])).toBeNull();
    expect(inferWorkoutPrescription([recovery(120), recovery(120)])).toBeNull();
  });

  it('snaps to the documented steps and formats m:ss', () => {
    expect(snapSeconds(843, 30)).toBe(840); // 14:03 -> 14:00
    expect(snapSeconds(133, 30)).toBe(120); // 2:13 jog block -> 2:00 prescribed
    expect(snapSeconds(190, 30)).toBe(180); // 3:10 jog block -> 3:00 prescribed
    expect(snapSeconds(0, 30)).toBe(0);
    expect(snapSeconds(Number.NaN, 30)).toBe(0);
    expect(WORK_SNAP_SECONDS).toBe(RECOVERY_SNAP_SECONDS);
    expect(formatPrescriptionClock(120)).toBe('2:00');
    expect(formatPrescriptionClock(900)).toBe('15:00');
  });
});
