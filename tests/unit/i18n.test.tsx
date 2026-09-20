// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LanguageProvider, useTranslation, interpolate } from '../../src/frontend/i18n/LanguageContext.js';
import { LOCALES, LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '../../src/frontend/i18n/types.js';

const Probe: React.FC = () => {
  const { language, locale, format, plural, formatDate, setLanguage } = useTranslation();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="locale">{locale}</span>
      <span data-testid="date">{formatDate('2026-09-01T00:00:00', { month: 'short', year: 'numeric' })}</span>
      <span data-testid="interpolated">{format('Zone 2: {hours}h ({pct}%)', { hours: 12, pct: 68 })}</span>
      <span data-testid="plural-one">{plural(1, { one: '{count} activity', other: '{count} activities' })}</span>
      <span data-testid="plural-many">{plural(3, { one: '{count} activity', other: '{count} activities' })}</span>
      <button type="button" onClick={() => setLanguage('zh')}>to-zh</button>
    </div>
  );
};

describe('i18n locale, interpolation and plural helpers', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('exposes a BCP-47 locale derived from the active language', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId('lang').textContent).toBe('en');
    expect(screen.getByTestId('locale').textContent).toBe(LOCALES.en);
  });

  it('formats dates with the active locale instead of a hardcoded one', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId('date').textContent).toBe('Sep 2026');

    fireEvent.click(screen.getByRole('button', { name: 'to-zh' }));
    expect(screen.getByTestId('lang').textContent).toBe('zh');
    expect(screen.getByTestId('locale').textContent).toBe(LOCALES.zh);
    expect(screen.getByTestId('date').textContent).toBe('2026年9月');
  });

  it('interpolates {token} placeholders and preserves unknown tokens', () => {
    expect(interpolate('Zone 2: {hours}h ({pct}%)', { hours: 12, pct: 68 })).toBe('Zone 2: 12h (68%)');
    expect(interpolate('a {missing} b', {})).toBe('a {missing} b');
  });

  it('selects plural forms using Intl.PluralRules for the active locale', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId('plural-one').textContent).toBe('1 activity');
    expect(screen.getByTestId('plural-many').textContent).toBe('3 activities');
  });

  it('keeps language switcher metadata in a single ordered source of truth', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['en', 'zh']);
    expect(LANGUAGE_LABELS.en.native).toBe('English');
    expect(LANGUAGE_LABELS.zh.native).toBe('简体中文');
  });
});
