// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotLoadingProgress } from '../../src/frontend/api/snapshot-loading.js';
import { LanguageProvider, useTranslation } from '../../src/frontend/i18n/LanguageContext.js';
import { SnapshotLoadingScreen } from '../../src/frontend/components/SnapshotLoadingScreen.js';

const store = vi.hoisted(() => ({ progress: { stage: 'downloading' } as SnapshotLoadingProgress, listeners: new Set<() => void>() }));
vi.mock('../../src/frontend/api/client.js', () => ({
  getSnapshotLoadingProgress: () => store.progress,
  subscribeSnapshotLoading: (callback: () => void) => { store.listeners.add(callback); return () => store.listeners.delete(callback); }
}));
afterEach(() => { cleanup(); localStorage.clear(); store.progress = { stage: 'downloading' }; });
function report(progress: SnapshotLoadingProgress) {
  act(() => { store.progress = progress; store.listeners.forEach(listener => listener()); });
}

describe('snapshot loading screen', () => {
  it('shows an indeterminate linear bar, optional real percentage, then preparation without a percentage', () => {
    render(<LanguageProvider><SnapshotLoadingScreen /></LanguageProvider>);
    const bar = screen.getByRole('progressbar');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('Downloading snapshot…');
    report({ stage: 'downloading', percent: 42 });
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(screen.getByText('42% downloaded')).toBeTruthy();
    report({ stage: 'preparing' });
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(screen.queryByText('42% downloaded')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Preparing dashboard…');
  });

  it('uses the Chinese loading dictionary', () => {
    function LanguageSwitch() {
      const { setLanguage } = useTranslation();
      return <button onClick={() => setLanguage('zh')}>Chinese</button>;
    }
    render(<LanguageProvider><LanguageSwitch /><SnapshotLoadingScreen /></LanguageProvider>);
    fireEvent.click(screen.getByText('Chinese'));
    expect(screen.getByRole('heading').textContent).toBe('正在加载快照');
    report({ stage: 'downloading', percent: 42 });
    expect(screen.getByText('已下载 42%')).toBeTruthy();
  });
});
