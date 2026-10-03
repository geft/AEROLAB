import { describe, expect, it } from 'vitest';
import { repairSpeedTelemetry } from '../../src/backend/domain/repair-speed.js';
import { workoutTrace } from '../fixtures/workout-trace.js';

describe('analysis speed repair', () => {
  it('repairs a copy from distance without changing raw export telemetry', () => {
    const { records } = workoutTrace([{ seconds: 30, hr: 140, speed: 3 }]);
    records.forEach(r => { r.speedMps = 2; });
    const original = structuredClone(records);
    expect(repairSpeedTelemetry(records).every(r => r.speedMps === 3)).toBe(true);
    expect(records).toEqual(original);
  });
  it('does not derive motion across recording gaps or stopped timer segments', () => {
    const { records } = workoutTrace([{ seconds: 30, hr: 140, speed: 3 }]);
    records.forEach(r => { r.speedMps = 2; r.timerSegment = r.elapsedSeconds < 15 ? 0 : 1; });
    records[15].distanceMeters = 10000;
    records[15].timerActive = false;
    const repaired = repairSpeedTelemetry(records);
    expect(repaired[14].speedMps).toBe(3);
    expect(repaired[15].speedMps).toBe(2);
    records.forEach((r, i) => { r.elapsedSeconds = i * 30; });
    expect(repairSpeedTelemetry(records)).toBe(records);
  });
});
