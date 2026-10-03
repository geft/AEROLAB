// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { invalidateActivityData, useActivityRevision } from '../../src/frontend/features/activity-revision.js';

afterEach(cleanup);
describe('shared activity revision', () => {
  it('refreshes all subscribed views together and allows unmounted views to unsubscribe', () => {
    const View = ({ name }: { name: string }) => <output data-testid={name}>{useActivityRevision()}</output>;
    const first = render(<View name="browse" />);
    render(<View name="stats" />);
    const before = Number(screen.getByTestId('browse').textContent);
    act(invalidateActivityData);
    expect(screen.getByTestId('browse').textContent).toBe(String(before + 1));
    expect(screen.getByTestId('stats').textContent).toBe(String(before + 1));
    first.unmount();
    act(invalidateActivityData);
    expect(screen.getByTestId('stats').textContent).toBe(String(before + 2));
  });
});
