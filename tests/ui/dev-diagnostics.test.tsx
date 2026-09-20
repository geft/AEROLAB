// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { DevDiagnosticsDrawer } from '../../src/frontend/components/DevDiagnosticsDrawer.js';
import { clientLogger } from '../../src/frontend/utils/clientLogger.js';

describe('DevDiagnosticsDrawer UI Component Tests', () => {
  const mockServerDiagnostics = {
    status: 'ok',
    timestamp: '2026-09-15T02:00:00.000Z',
    system: {
      nodeVersion: 'v20.10.0',
      platform: 'win32',
      uptimeSeconds: 3600,
      memoryMb: { heapUsed: 45.2, heapTotal: 80.0, rss: 110.5 }
    },
    db: {
      path: 'data/runs.db',
      sizeMb: 12.5,
      activityCount: 190,
      intervalCount: 840,
      splitCount: 1200,
      recordCount: 95000
    },
    athlete: {
      configured: true,
      dob: '1995-05-10',
      restingHr: 52,
      maxHr: 198,
      lt1Hr: 145,
      lt2Hr: 168,
      baselineEconomyEf: 1.28
    },
    logs: []
  };

  beforeEach(() => {
    clientLogger.clear();
    clientLogger.info('TEST_INIT', 'Client logger initialized');
    clientLogger.error('TEST_ALERT', 'Simulated failure event', new Error('Component crashed'));

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, _opts?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/dev/diagnostics')) {
        return {
          ok: true,
          json: async () => mockServerDiagnostics
        } as any;
      }
      if (urlStr.includes('/api/dev/test-error')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'Dev Mode simulated API 400 test error', code: 'ERR_SIMULATED_TEST' })
        } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders drawer header, tabs, and captured logs when open', async () => {
    const onClose = vi.fn();
    render(<DevDiagnosticsDrawer isOpen={true} onClose={onClose} theme="dark" />);

    expect(screen.getByText(/AEROLAB Dev Diagnostics/i)).toBeTruthy();
    expect(screen.getByText('DEV MODE')).toBeTruthy();

    // Check that captured logs are visible
    expect(screen.getByText(/Client logger initialized/i)).toBeTruthy();
    expect(screen.getByText(/Simulated failure event/i)).toBeTruthy();
    expect(screen.getAllByText(/Component crashed/i).length).toBeGreaterThanOrEqual(1);
  });

  it('filters logs by log level chip', async () => {
    render(<DevDiagnosticsDrawer isOpen={true} onClose={vi.fn()} theme="dark" />);

    // Click ERROR filter
    const errorChip = screen.getByRole('button', { name: /^ERROR$/i });
    await act(async () => {
      fireEvent.click(errorChip);
    });

    // Error log should remain, INFO log should be hidden
    expect(screen.getByText(/Simulated failure event/i)).toBeTruthy();
    expect(screen.queryByText(/Client logger initialized/i)).toBeNull();

    // Click ALL filter to restore
    const allChip = screen.getByRole('button', { name: /^ALL$/i });
    await act(async () => {
      fireEvent.click(allChip);
    });
    expect(screen.getByText(/Client logger initialized/i)).toBeTruthy();
  });

  it('switches to Database & SSOT tab and displays SQLite metrics', async () => {
    render(<DevDiagnosticsDrawer isOpen={true} onClose={vi.fn()} theme="dark" />);

    const dbTabBtn = screen.getByRole('button', { name: /Database & SSOT/i });
    await act(async () => {
      fireEvent.click(dbTabBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/SQLite Storage Metrics/i)).toBeTruthy();
      expect(screen.getByText('190')).toBeTruthy(); // activity count
      expect(screen.getByText('840')).toBeTruthy(); // interval count
      expect(screen.getByText(/12.5 MB/i)).toBeTruthy(); // size
      expect(screen.getByText(/145 bpm/i)).toBeTruthy(); // LT1 HR
      expect(screen.getByText(/168 bpm/i)).toBeTruthy(); // LT2 HR
    });
  });

  it('clears logs when Clear button is clicked', async () => {
    render(<DevDiagnosticsDrawer isOpen={true} onClose={vi.fn()} theme="dark" />);

    expect(screen.getByText(/Client logger initialized/i)).toBeTruthy();

    const clearBtn = screen.getByRole('button', { name: /Clear/i });
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    expect(screen.queryByText(/Client logger initialized/i)).toBeNull();
    expect(screen.getByText(/No logs captured yet/i)).toBeTruthy();
  });

  it('triggers simulated API error in Error Sandbox tab', async () => {
    render(<DevDiagnosticsDrawer isOpen={true} onClose={vi.fn()} theme="dark" />);

    const sandboxTabBtn = screen.getByRole('button', { name: /Error Sandbox/i });
    await act(async () => {
      fireEvent.click(sandboxTabBtn);
    });

    expect(screen.getByText(/Diagnose & Verify Error Handling/i)).toBeTruthy();

    const triggerApiBtn = screen.getByRole('button', { name: /Trigger API 400 Error/i });
    await act(async () => {
      fireEvent.click(triggerApiBtn);
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/dev/test-error', expect.any(Object));
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(<DevDiagnosticsDrawer isOpen={true} onClose={onClose} theme="dark" />);

    const closeBtn = screen.getByTitle(/Close Dev Drawer/i);
    await act(async () => {
      fireEvent.click(closeBtn);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
