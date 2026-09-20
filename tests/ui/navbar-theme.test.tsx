// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Navbar } from '../../src/frontend/components/Navbar.js';
import { LanguageProvider } from '../../src/frontend/i18n/LanguageContext.js';
import { FontSizeProvider } from '../../src/frontend/context/FontSizeContext.js';

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

  it('renders language switcher dropdown and switches language via dropdown menu', () => {
    render(
      <LanguageProvider>
        <FontSizeProvider>
          <Navbar
            activeTab="browse"
            onTabChange={vi.fn()}
            onOpenUpload={vi.fn()}
            theme="dark"
            onToggleTheme={vi.fn()}
          />
        </FontSizeProvider>
      </LanguageProvider>
    );

    const langBtn = document.getElementById('language-toggle-btn');
    expect(langBtn).toBeTruthy();
    expect(langBtn?.textContent).toContain('English');

    // Click language button to open dropdown menu
    fireEvent.click(langBtn!);
    const zhOption = document.getElementById('lang-option-zh');
    expect(zhOption).toBeTruthy();
    expect(zhOption?.textContent).toContain('简体中文');

    // Select Chinese
    fireEvent.click(zhOption!);
    expect(langBtn?.textContent).toContain('简体中文');
    expect(document.getElementById('tab-browse-btn')?.textContent).toContain('跑步记录');
    expect(document.getElementById('tab-progress-btn')?.textContent).toContain('训练进展');

    // Click again to open menu and select English
    fireEvent.click(langBtn!);
    const enOption = document.getElementById('lang-option-en');
    expect(enOption).toBeTruthy();
    fireEvent.click(enOption!);
    expect(langBtn?.textContent).toContain('English');
    expect(document.getElementById('tab-browse-btn')?.textContent).toContain('Browse');
  });

  it('renders font size dropdown and changes font size scale', () => {
    render(
      <LanguageProvider>
        <FontSizeProvider>
          <Navbar
            activeTab="browse"
            onTabChange={vi.fn()}
            onOpenUpload={vi.fn()}
            theme="dark"
            onToggleTheme={vi.fn()}
          />
        </FontSizeProvider>
      </LanguageProvider>
    );

    const incBtn = document.getElementById('font-size-inc-btn');
    const decBtn = document.getElementById('font-size-dec-btn');
    const label = document.getElementById('font-size-current-val');

    expect(incBtn).toBeTruthy();
    expect(decBtn).toBeTruthy();
    expect(label?.textContent).toContain('100%');

    // Click + to reach large (125%)
    fireEvent.click(incBtn!);
    expect(document.documentElement.getAttribute('data-font-size')).toBe('large');
    expect(label?.textContent).toContain('125%');

    // Click + to reach xlarge (150% max cap)
    fireEvent.click(incBtn!);
    expect(document.documentElement.getAttribute('data-font-size')).toBe('xlarge');
    expect(label?.textContent).toContain('150%');
    expect((incBtn as HTMLButtonElement).disabled).toBe(true);

    // Click - to step down
    fireEvent.click(decBtn!);
    expect(document.documentElement.getAttribute('data-font-size')).toBe('large');
    expect(label?.textContent).toContain('125%');

    fireEvent.click(decBtn!);
    expect(document.documentElement.getAttribute('data-font-size')).toBe('medium');
    expect(label?.textContent).toContain('100%');

    fireEvent.click(decBtn!);
    expect(document.documentElement.getAttribute('data-font-size')).toBe('small');
    expect(label?.textContent).toContain('75%');
    expect((decBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
