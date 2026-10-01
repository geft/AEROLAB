// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRunChart } from '../../src/frontend/components/CanvasRunChart.js';

const context = {
  scale: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  stroke: vi.fn(), fill: vi.fn(), closePath: vi.fn(), fillText: vi.fn(), save: vi.fn(), restore: vi.fn(),
  setLineDash: vi.fn(), arc: vi.fn(),
  strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: 'left',
};
let resizeCallback: ResizeObserverCallback | undefined;

class TestResizeObserver {
  constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

const points = [
  { elapsed_seconds: 0, heart_rate: 130, speed_mps: 3, altitude_m: 12, distance_m: 0, cadence: 170 },
  { elapsed_seconds: 60, heart_rate: 145, speed_mps: 2.8, altitude_m: 18, distance_m: 175, cadence: 172 },
  { elapsed_seconds: 120, heart_rate: 150, speed_mps: 2.6, altitude_m: 15, distance_m: 350, cadence: 174 },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resizeCallback = undefined;
  for (const key of ['scale', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'closePath', 'fillText', 'save', 'restore', 'setLineDash', 'arc'] as const) context[key].mockClear();
});

function setCanvasBounds(width = 500, height = 220) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}),
  });
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
}

describe('CanvasRunChart', () => {
  it('draws the chart and uses the slider to select its readout and marker', () => {
    setCanvasBounds();
    render(<CanvasRunChart records={points} theme="light" />);

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 500, 220);
    expect(context.stroke).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
    const slider = screen.getByRole('slider', { name: 'Select a point in the run chart' });
    fireEvent.change(slider, { target: { value: '2' } });
    expect(screen.getByText('Distance:')).toBeTruthy();
    expect(screen.getByText('0.35 km')).toBeTruthy();
    expect(screen.getByText('6:25/km')).toBeTruthy();
    expect(screen.getByText('150 bpm')).toBeTruthy();
    expect(screen.getByText('15 m')).toBeTruthy();

    expect(context.setLineDash).toHaveBeenCalledWith([4, 4]);
    expect(context.arc).toHaveBeenCalled();
  });

  it('updates the telemetry readout on desktop hover and clears it on pointer leave', () => {
    setCanvasBounds();
    const { container } = render(<CanvasRunChart records={points} theme="light" />);

    const canvas = container.querySelector('canvas')!;
    fireEvent.pointerMove(canvas, { clientX: 238 });
    expect(screen.getByText('0.17 km')).toBeTruthy();
    expect(screen.getByText('5:57/km')).toBeTruthy();
    expect(screen.getByText('145 bpm')).toBeTruthy();

    fireEvent.pointerLeave(canvas);
    expect(container.querySelector('.telemetry-chart-readout')).toBeNull();
    expect(container.querySelector('.telemetry-chart-readout-slot')).toBeTruthy();
  });

  it('uses fallback ranges when telemetry is missing and redraws after resize', () => {
    setCanvasBounds();
    render(<CanvasRunChart records={[
      { elapsed_seconds: 10, heart_rate: null, speed_mps: null, altitude_m: null, distance_m: null, cadence: null },
      { elapsed_seconds: 20, heart_rate: 40, speed_mps: 0.5, altitude_m: null, distance_m: 100, cadence: null },
    ]} />);
    const initialDraws = context.clearRect.mock.calls.length;
    expect(initialDraws).toBe(1);
    act(() => resizeCallback?.([], {} as ResizeObserver));
    expect(context.clearRect).toHaveBeenCalledTimes(initialDraws + 1);
    fireEvent.change(screen.getByRole('slider', { name: 'Select a point in the run chart' }), { target: { value: '1' } });
    expect(screen.getByText('40 bpm')).toBeTruthy();
    expect(screen.getAllByText('—', { selector: 'b' })).toHaveLength(2);
  });

  it('does not draw empty records', () => {
    setCanvasBounds();
    render(<CanvasRunChart records={[]} />);
    expect(context.clearRect).not.toHaveBeenCalled();
  });
});
