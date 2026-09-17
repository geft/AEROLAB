// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Navbar, TabType } from '../../src/frontend/components/Navbar.js';
import { LanguageProvider } from '../../src/frontend/i18n/LanguageContext.js';

describe('Navbar & Theme Switcher UI Component Tests', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders AEROLAB brand, tabs, and active tab highlights', () => {
    const onTabChange = vi.fn();
    const onOpenUpload = vi.fn();
    const onToggleTheme = vi.fn();

    render(
      <Navbar
        activeTab="browse"
        onTabChange={onTabChange}
        onOpenUpload={onOpenUpload}
        theme="dark"
        onToggleTheme={onToggleTheme}
      />
    );

    expect(screen.getByText('AEROLAB')).toBeTruthy();
    const browseBtn = screen.getByRole('button', { name: /browse/i });
    const progressBtn = screen.getByRole('button', { name: /progress/i });
    const statsBtn = screen.getByRole('button', { name: /stats/i });

    expect(browseBtn.className).toContain('active');
    expect(progressBtn.className).not.toContain('active');
    expect(statsBtn.className).not.toContain('active');
  });

  it('triggers onTabChange when navigation tabs are clicked', () => {
    const onTabChange = vi.fn();
    render(
      <Navbar
        activeTab="browse"
        onTabChange={onTabChange}
        onOpenUpload={vi.fn()}
        theme="dark"
        onToggleTheme={vi.fn()}
      />
    );

    const progressBtn = screen.getByRole('button', { name: /progress/i });
    fireEvent.click(progressBtn);
    expect(onTabChange).toHaveBeenCalledWith('progress');

    const statsBtn = screen.getByRole('button', { name: /stats/i });
    fireEvent.click(statsBtn);
    expect(onTabChange).toHaveBeenCalledWith('stats');
  });

  it('displays Day Mode label in dark theme and triggers toggle', () => {
    const onToggleTheme = vi.fn();
    render(
      <Navbar
        activeTab="browse"
        onTabChange={vi.fn()}
        onOpenUpload={vi.fn()}
        theme="dark"
        onToggleTheme={onToggleTheme}
      />
    );

    const themeBtn = document.getElementById('theme-toggle-btn');
    expect(themeBtn).toBeTruthy();
    expect(themeBtn?.textContent).toContain('Day Mode');

    fireEvent.click(themeBtn!);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('displays Night Mode label in light theme and triggers toggle', () => {
    const onToggleTheme = vi.fn();
    render(
      <Navbar
        activeTab="browse"
        onTabChange={vi.fn()}
        onOpenUpload={vi.fn()}
        theme="light"
        onToggleTheme={onToggleTheme}
      />
    );

    const themeBtn = document.getElementById('theme-toggle-btn');
    expect(themeBtn).toBeTruthy();
    expect(themeBtn?.textContent).toContain('Night Mode');

    fireEvent.click(themeBtn!);
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('triggers onOpenUpload when Import FIT / CSV button is clicked', () => {
    const onOpenUpload = vi.fn();
    render(
      <Navbar
        activeTab="browse"
        onTabChange={vi.fn()}
        onOpenUpload={onOpenUpload}
        theme="dark"
        onToggleTheme={vi.fn()}
      />
    );

    const uploadBtn = document.getElementById('nav-upload-btn');
    expect(uploadBtn).toBeTruthy();
    expect(uploadBtn?.textContent).toContain('Import FIT / CSV');
    fireEvent.click(uploadBtn!);
    expect(onOpenUpload).toHaveBeenCalledTimes(1);
  });

  it('renders language switcher toggle button next to theme toggle and switches language', () => {
    render(
      <LanguageProvider>
        <Navbar
          activeTab="browse"
          onTabChange={vi.fn()}
          onOpenUpload={vi.fn()}
          theme="dark"
          onToggleTheme={vi.fn()}
        />
      </LanguageProvider>
    );

    const langBtn = document.getElementById('language-toggle-btn');
    expect(langBtn).toBeTruthy();
    expect(langBtn?.textContent).toContain('中文');

    // Click language button to switch to Chinese
    fireEvent.click(langBtn!);
    expect(langBtn?.textContent).toContain('EN');
    expect(document.getElementById('tab-browse-btn')?.textContent).toContain('跑步记录');
    expect(document.getElementById('tab-progress-btn')?.textContent).toContain('训练进展');

    // Click again to switch back to English
    fireEvent.click(langBtn!);
    expect(langBtn?.textContent).toContain('中文');
    expect(document.getElementById('tab-browse-btn')?.textContent).toContain('Browse');
  });
});
