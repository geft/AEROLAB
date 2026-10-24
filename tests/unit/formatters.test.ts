import { describe, it, expect } from 'vitest';
import { formatPace, formatDate, formatDuration, formatEfficiency } from '../../src/frontend/utils/formatters.js';

describe('Formatters Unit Tests', () => {
  describe('formatPace', () => {
    it('formats pace in seconds per kilometer to M:SS/km', () => {
      expect(formatPace(300)).toBe('5:00/km');
      expect(formatPace(305)).toBe('5:05/km');
      expect(formatPace(267)).toBe('4:27/km');
      expect(formatPace(414)).toBe('6:54/km');
    });

    it('formats pace without unit when includeUnit is false', () => {
      expect(formatPace(300, false)).toBe('5:00');
      expect(formatPace(305, false)).toBe('5:05');
      expect(formatPace(267, false)).toBe('4:27');
    });

    it('returns fallback dash for null, undefined, zero, negative, or NaN', () => {
      expect(formatPace(null)).toBe('—');
      expect(formatPace(undefined)).toBe('—');
      expect(formatPace(0)).toBe('—');
      expect(formatPace(-50)).toBe('—');
      expect(formatPace(NaN)).toBe('—');
    });
  });

  describe('formatDate', () => {
    it('formats valid date string', () => {
      const formatted = formatDate('2026-09-12 17:32:55');
      expect(formatted).toBe('2026-09-12');
    });

    it('returns fallback dash for empty or null date', () => {
      expect(formatDate('')).toBe('—');
      expect(formatDate(null as any)).toBe('—');
    });

    it('returns original string if invalid date', () => {
      expect(formatDate('invalid-date-string')).toBe('invalid-date-string');
    });
  });

  describe('formatDuration', () => {
    it('formats durations under 1 hour to MM:SS', () => {
      expect(formatDuration(65)).toBe('1:05');
      expect(formatDuration(1800)).toBe('30:00');
      expect(formatDuration(3599)).toBe('59:59');
    });

    it('formats durations of 1 hour or more to H:MM:SS', () => {
      expect(formatDuration(3600)).toBe('1:00:00');
      expect(formatDuration(3665)).toBe('1:01:05');
      expect(formatDuration(7325)).toBe('2:02:05');
    });

    it('returns 0:00 for null, undefined, zero, or negative', () => {
      expect(formatDuration(null)).toBe('0:00');
      expect(formatDuration(undefined)).toBe('0:00');
      expect(formatDuration(0)).toBe('0:00');
      expect(formatDuration(-10)).toBe('0:00');
    });
  });

  describe('formatEfficiency', () => {
    it('formats efficiency factor to 2 decimal places', () => {
      expect(formatEfficiency(1.1561)).toBe('1.16');
      expect(formatEfficiency(1.0606)).toBe('1.06');
      expect(formatEfficiency(1.2)).toBe('1.20');
    });

    it('returns fallback dash for null, undefined, zero, or negative', () => {
      expect(formatEfficiency(null)).toBe('—');
      expect(formatEfficiency(undefined)).toBe('—');
      expect(formatEfficiency(0)).toBe('—');
      expect(formatEfficiency(-1)).toBe('—');
    });
  });
});
