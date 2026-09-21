// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { IntervalsTable } from '../../src/frontend/components/browse/IntervalsTable.js';
import type { ActivityInterval } from '../../src/frontend/types/api.js';

afterEach(cleanup);

const seg = (interval_index: number, type: string, duration_seconds: number): ActivityInterval => ({
  id: interval_index,
  activity_id: 'act-aug-31',
  interval_index,
  type,
  start_seconds: 0,
  duration_seconds,
  distance_meters: 1000,
  avg_speed_mps: 4,
  avg_pace_sec_km: 250,
  avg_heart_rate: 180,
  max_heart_rate: 190,
  avg_cadence: 188,
  hr_drop: 30
});

describe('Interval table prescription hint', () => {
  it('reads back the prescription the athlete ran, not the measured jog block', () => {
    // Real Aug-31 VO2 set: Garmin logged 4 x 4:00 with 2:00 recoveries; the jog
    // blocks measure 2:15 / 2:10 / 2:13. The table's old grid said 2:00 by accident,
    // the detector said 2:15, and both were guessing — now one shared rule says 2:00.
    render(
      <IntervalsTable
        intervals={[
          seg(1, 'work', 244), seg(2, 'recovery', 135),
          seg(3, 'work', 244), seg(4, 'recovery', 130),
          seg(5, 'work', 243), seg(6, 'recovery', 133),
          seg(7, 'work', 249)
        ]}
        activityRunType="intervals_vo2"
        formatPace={(secKm) => `${secKm}s/km`}
        formatTime={(sec) => `${sec}s`}
      />
    );

    expect(screen.getByText('4x4:00 / 2:00 rec')).toBeTruthy();
    expect(screen.queryByText(/2:15 rec/)).toBeNull();
    // The rows still show the raw measured block so nothing is hidden.
    expect(screen.getByText('135s')).toBeTruthy();
  });

  it('leaves out the recovery when the run has no recoveries between reps', () => {
    render(
      <IntervalsTable
        intervals={[seg(1, 'work', 900), seg(2, 'work', 900)]}
        activityRunType="threshold_lt2"
        formatPace={(secKm) => `${secKm}s/km`}
        formatTime={(sec) => `${sec}s`}
      />
    );

    expect(screen.getByText('2x15:00')).toBeTruthy();
  });
});
