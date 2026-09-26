// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasRunChart } from '../../src/frontend/components/CanvasRunChart.js';

const context = {
  scale: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  stroke: vi.fn(), fill: vi.fn(), closePath: vi.fn(), fillText: vi.fn(),
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
  for (const key of ['scale', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'closePath', 'fillText'] as const) context[key].mockClear();
});

function setCanvasBounds(width = 500, height = 220) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}),
  });
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
}

describe('CanvasRunChart', () => {
  it('draws the chart, supports hover readouts, and clears them on leave', () => {
    setCanvasBounds();
    render(<CanvasRunChart records={points} theme="light" />);

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 500, 220);
    expect(context.stroke).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
    const wrapper = document.querySelector('.chart-canvas-wrapper')!;
    fireEvent.mouseMove(wrapper, { clientX: 460 });
    expect(screen.getByText('Dist:')).toBeTruthy();
    expect(screen.getByText('0.35 km')).toBeTruthy();
    expect(screen.getByText('6:25/km')).toBeTruthy();
    expect(screen.getByText('150 bpm')).toBeTruthy();
    expect(screen.getByText('15m')).toBeTruthy();

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByText('0.35 km')).toBeNull();
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
    fireEvent.mouseMove(document.querySelector('.chart-canvas-wrapper')!, { clientX: 40 });
    expect(screen.getByText('— bpm')).toBeTruthy();
    expect(screen.getAllByText('—', { selector: 'b' })).toHaveLength(2);
  });

  it('does not draw empty records', () => {
    setCanvasBounds();
    render(<CanvasRunChart records={[]} />);
    expect(context.clearRect).not.toHaveBeenCalled();
  });
});
