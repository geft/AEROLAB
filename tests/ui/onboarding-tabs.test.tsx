// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OnboardingPage } from '../../src/frontend/components/OnboardingPage.js';
import { LanguageProvider } from '../../src/frontend/i18n/LanguageContext.js';

describe('Onboarding Tabs & Restore Flow UI Tests', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/profile')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ isConfigured: false, profile: null })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({})
      });
    });
  });

  it('renders the two onboarding mode tabs and switches between them', async () => {
    const onCompleted = vi.fn();
    render(
      <LanguageProvider>
        <OnboardingPage onCompleted={onCompleted} />
      </LanguageProvider>
    );

    // Initial setup tab
    expect(screen.getByText('New Athlete Setup')).toBeTruthy();
    expect(screen.getByText('Restore Backup (.db)')).toBeTruthy();
    expect(screen.getByText('Date of Birth')).toBeTruthy();

    // The direct FIT/CSV import tab was removed: importing activities before a
    // profile exists produced invalid profile data.
    expect(screen.queryByText('Import Workouts')).toBeNull();
    expect(screen.queryByText('Import Workout Files')).toBeNull();

    // Click Restore Backup tab
    fireEvent.click(screen.getByText('Restore Backup (.db)'));
    await waitFor(() => {
      expect(screen.getByText(/Restore from Database Snapshot/i)).toBeTruthy();
    });
  });

  it('shows no default values and blocks submission until the required fields are filled', async () => {
    const onCompleted = vi.fn();
    render(
      <LanguageProvider>
        <OnboardingPage onCompleted={onCompleted} />
      </LanguageProvider>
    );

    const dobInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    const rhrInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    const genderSelect = document.querySelector('select') as HTMLSelectElement;
    const submitBtn = screen.getByRole('button', { name: /Save & Launch AEROLAB/i }) as HTMLButtonElement;

    // Nothing is pre-filled from the unconfigured profile row.
    expect(dobInput.value).toBe('');
    expect(rhrInput.value).toBe('');
    expect(genderSelect.value).toBe('');
    expect(submitBtn.disabled).toBe(true);

    // Each required field must be present on its own merits.
    fireEvent.change(dobInput, { target: { value: '1992-06-10' } });
    expect(submitBtn.disabled).toBe(true);

    fireEvent.change(rhrInput, { target: { value: '62' } });
    await waitFor(() => {
      expect(submitBtn.disabled).toBe(false);
    });

    // Gender is optional: it was never touched, yet the form is submittable.
    expect(genderSelect.value).toBe('');

    fireEvent.click(submitBtn);

    const patchCall = await waitFor(() => {
      const call = (global.fetch as any).mock.calls.find(
        (c: any[]) => c[0] === '/api/profile' && c[1]?.method === 'PATCH'
      );
      expect(call).toBeTruthy();
      return call;
    });
    const patchBody = JSON.parse(patchCall[1].body);
    expect(patchBody.dob).toBe('1992-06-10');
    expect(patchBody.resting_hr).toBe(62);
    expect(patchBody.is_configured).toBe(1);
    // An untouched optional gender must not be written as empty data.
    expect('gender' in patchBody).toBe(false);
    await waitFor(() => {
      expect(onCompleted).toHaveBeenCalledTimes(1);
    });
  });

  it('sends the gender once the athlete chooses one', async () => {
    render(
      <LanguageProvider>
        <OnboardingPage onCompleted={vi.fn()} />
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/profile');
    });

    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '1992-06-10' } });
    fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '62' } });
    fireEvent.change(document.querySelector('select')!, { target: { value: 'Female' } });

    const submitBtn = screen.getByRole('button', { name: /Save & Launch AEROLAB/i }) as HTMLButtonElement;
    await waitFor(() => {
      expect(submitBtn.disabled).toBe(false);
    });
    fireEvent.click(submitBtn);

    const patchCall = await waitFor(() => {
      const call = (global.fetch as any).mock.calls.find(
        (c: any[]) => c[0] === '/api/profile' && c[1]?.method === 'PATCH'
      );
      expect(call).toBeTruthy();
      return call;
    });
    expect(JSON.parse(patchCall[1].body).gender).toBe('Female');
  });

  it('requires a date of birth and has no manual max HR entry', async () => {
    render(
      <LanguageProvider>
        <OnboardingPage onCompleted={vi.fn()} />
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/profile');
    });

    const submitBtn = screen.getByRole('button', { name: /Save & Launch AEROLAB/i }) as HTMLButtonElement;

    expect(screen.queryByRole('button', { name: /^Manual$/i })).toBeNull();
    const numberInputs = document.querySelectorAll('input[type="number"]');
    expect(numberInputs).toHaveLength(1);
    fireEvent.change(numberInputs[0], { target: { value: '62' } });

    expect(submitBtn.disabled).toBe(true);

    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: '1992-06-10' } });
    await waitFor(() => {
      expect(submitBtn.disabled).toBe(false);
    });
  });

  it('rejects an out-of-range resting heart rate instead of enabling submission', async () => {
    render(
      <LanguageProvider>
        <OnboardingPage onCompleted={vi.fn()} />
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/profile');
    });

    const dobInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    const rhrInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    const genderSelect = document.querySelector('select') as HTMLSelectElement;
    const submitBtn = screen.getByRole('button', { name: /Save & Launch AEROLAB/i }) as HTMLButtonElement;

    fireEvent.change(dobInput, { target: { value: '1992-06-10' } });
    fireEvent.change(genderSelect, { target: { value: 'Female' } });
    fireEvent.change(rhrInput, { target: { value: '140' } });

    expect(submitBtn.disabled).toBe(true);
  });
});
