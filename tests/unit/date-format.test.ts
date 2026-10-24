import { describe, expect, it } from 'vitest';
import { formatDateValue } from '../../src/frontend/i18n/date-format.js';
import { LOCALES } from '../../src/frontend/i18n/types.js';

describe('Compact full dates', () => {
  it('uses YYYY-MM-DD in both supported languages and pads month and day', () => {
    for (const locale of Object.values(LOCALES)) {
      expect(formatDateValue('2026-01-05 12:00:00', locale)).toBe('2026-01-05');
      expect(formatDateValue('2026-01-05T12:00:00', locale, { year: 'numeric', month: 'short', day: 'numeric' })).toBe('2026-01-05');
    }
  });
  it('preserves partial dates and time formats and handles invalid dates', () => {
    expect(formatDateValue('2026-01-05T12:00:00', LOCALES.en, { year: 'numeric', month: 'short' })).toBe('Jan 2026');
    expect(formatDateValue('bad date', LOCALES.en)).toBe('');
  });
});
