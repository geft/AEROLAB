// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BaselineSetupModal } from '../../src/frontend/components/BaselineSetupModal.js';

describe('BaselineSetupModal Onboarding Tests', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders required baseline fields and dynamically computes age from birth date', async () => {
    render(
      <BaselineSetupModal
        isOpen={true}
        onCompleted={vi.fn()}
        initialDob="1990-05-20"
        initialGender="Female"
        initialRestingHr={58}
        initialMaxHr={188}
        initialVo2Max={46}
      />
    );

    expect(screen.getByText('Cardiovascular Baseline Setup')).toBeTruthy();
    expect(screen.getByDisplayValue('1990-05-20')).toBeTruthy();
    expect(screen.getByDisplayValue('58')).toBeTruthy();
    expect(screen.getByDisplayValue('Female')).toBeTruthy();

    // Age dynamically computed from 1990 (36 in 2026)
    expect(screen.getByText(/Age: 36 yrs/i)).toBeTruthy();

    // Changing birth date dynamically updates computed age
    const dobInput = screen.getByDisplayValue('1990-05-20');
    fireEvent.change(dobInput, { target: { value: '2000-05-20' } });
    expect(screen.getByText(/Age: 26 yrs/i)).toBeTruthy();
  });

  it('submits baselines with is_configured=1 on submit', async () => {
    let patchBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: any, opts: any) => {
      patchBody = JSON.parse(opts.body);
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: 'ok' })
      } as any);
    });

    const onCompletedMock = vi.fn();

    render(
      <BaselineSetupModal
        isOpen={true}
        onCompleted={onCompletedMock}
        initialDob="1992-06-10"
        initialGender="Male"
        initialRestingHr={62}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Save Baselines & Start AEROLAB/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(patchBody).toBeTruthy();
      expect(patchBody.dob).toBe('1992-06-10');
      expect(patchBody.resting_hr).toBe(62);
      expect(patchBody.is_configured).toBe(1);
      expect(onCompletedMock).toHaveBeenCalledTimes(1);
    });
  });
});
