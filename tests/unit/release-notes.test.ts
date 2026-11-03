import { describe, expect, it } from 'vitest';
import { parseChangelog, selectReleaseNotes } from '../../scripts/write-release-notes.js';

const changelog = `# Changelog

## 1.5.7 — 2026-11-03

### Analysis

- Strides with a walk recovery.

## 1.5.6 — 2026-11-02

- Replay the history in seconds.

## 1.5.5

- Older notes.
`;

describe('Release notes selection', () => {
  it('takes the entry for the version being released, not the newest one', () => {
    expect(selectReleaseNotes(changelog, '1.5.6')).toBe('- Replay the history in seconds.');
  });

  it('accepts a dated heading and a bare version heading alike', () => {
    expect(selectReleaseNotes(changelog, '1.5.5')).toBe('- Older notes.');
    expect(selectReleaseNotes(changelog, 'v1.5.7')).toContain('Strides with a walk recovery.');
  });

  it('parses every entry, so a version can be selected from anywhere in the file', () => {
    expect(parseChangelog(changelog).map(entry => entry.version)).toEqual(['1.5.7', '1.5.6', '1.5.5']);
  });

  it('reports a version that has no entry instead of publishing another release\'s notes', () => {
    // v1.5.6 and v1.5.7 both shipped the v1.5.5 notes because the first entry
    // in the file was used for every release.
    expect(() => selectReleaseNotes(changelog, '1.5.8')).toThrow(/no entry for 1\.5\.8/);
  });

  it('rejects an empty entry rather than publishing a blank description', () => {
    expect(() => selectReleaseNotes('## 1.5.7\n\n## 1.5.6\n- Older notes.\n', '1.5.7')).toThrow(/is empty/);
  });

  it('rejects a missing version', () => {
    expect(() => selectReleaseNotes(changelog, '  ')).toThrow(/No release version/);
  });
});
