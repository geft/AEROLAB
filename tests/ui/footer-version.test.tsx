// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Footer } from '../../src/frontend/components/Footer.js';

describe('Footer', () => {
  it('keeps the app name and copyright in a single concise line', () => {
    const { container } = render(<Footer />);
    const footer = container.querySelector('.app-footer');

    expect(footer?.textContent).toContain('© 2026 AEROLAB');
    expect(footer?.textContent).toContain('Offline-First');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/v\d+\.\d+/)).toBeNull();
  });
});
