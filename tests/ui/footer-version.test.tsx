// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { Footer } from '../../src/frontend/components/Footer.js';
import { BUILD_INFO } from '../../src/frontend/version.js';

describe('Footer Auto-Versioning UI Component Tests', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockImplementation(() => Promise.resolve())
      }
    });
  });

  it('renders copyright and auto versioning label with version and commit hash', () => {
    render(<Footer />);

    // Copyright label
    expect(screen.getByText(/© 2026 AEROLAB • Designed for GJ/i)).toBeTruthy();

    // Auto version badge
    expect(screen.getByText(`v${BUILD_INFO.version}`)).toBeTruthy();
    expect(screen.getByText(`(${BUILD_INFO.gitCommit})`)).toBeTruthy();

    // Button accessible label
    const versionBtn = screen.getByRole('button', { name: /app build and version information/i });
    expect(versionBtn).toBeTruthy();
    expect(versionBtn.getAttribute('title')).toContain(BUILD_INFO.gitCommit);
    expect(versionBtn.getAttribute('title')).toContain(BUILD_INFO.buildDate);
  });

  it('copies build debug details when version badge is clicked', async () => {
    render(<Footer />);

    const versionBtn = screen.getByRole('button', { name: /app build and version information/i });
    fireEvent.click(versionBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(`AEROLAB v${BUILD_INFO.version}`)
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(BUILD_INFO.gitCommit)
    );

    // Shows Copied! state
    await waitFor(() => {
      expect(screen.getByText(/Copied!/i)).toBeTruthy();
    });
  });
});
