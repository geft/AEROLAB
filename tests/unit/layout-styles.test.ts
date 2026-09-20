import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Layout regression guards.
 *
 * These lock in the CSS contract for surfaces that previously had no stylesheet
 * rules at all (bare `.card` widgets), for design tokens that were referenced but
 * never declared (so the property silently fell back to an invalid value), and for
 * the trailing gutter inside the two scrollable guide modals.
 */
describe('Layout stylesheet contracts', () => {
  const rootDir = process.cwd();
  const cssPath = path.join(rootDir, 'src/frontend/styles/index.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  const ruleBody = (selector: string): string => {
    // Escape regex metacharacters, then allow any whitespace between the
    // selector list and the opening brace (e.g. "a,\n b {").
    const escaped = selector
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s*');
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    expect(match, `Missing "${selector}" rule in index.css`).toBeTruthy();
    return match![1];
  };

  it('declares every CSS custom property referenced anywhere in the frontend', () => {
    const declared = new Set<string>();
    for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(m[1]);

    const walked: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(tsx|ts|css)$/.test(entry.name)) walked.push(full);
      }
    };
    walk(path.join(rootDir, 'src/frontend'));

    const undefinedVars = new Map<string, string>();
    for (const file of walked) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
          if (!declared.has(m[1]) && !undefinedVars.has(m[1])) {
            undefinedVars.set(m[1], `${path.relative(rootDir, file)}:${idx + 1}`);
          }
        }
      });
    }

    expect([...undefinedVars.entries()]).toEqual([]);
  });

  it('defines the theme tokens that were previously missing', () => {
    const root = ruleBody(':root');
    for (const token of ['--bg-base', '--bg-card-subtle', '--border-hover', '--font-mono']) {
      expect(root, `${token} must be declared in :root`).toMatch(new RegExp(`${token}:`));
    }
    const light = ruleBody('[data-theme="light"]');
    for (const token of ['--bg-base', '--bg-card-subtle', '--border-hover']) {
      expect(light, `${token} must be declared for the light theme`).toMatch(new RegExp(`${token}:`));
    }
  });

  it('gives the bare .card widget surface real card chrome', () => {
    const card = ruleBody('.card');
    expect(card).toMatch(/background:\s*var\(--bg-card\)/);
    expect(card).toMatch(/border:\s*1px solid var\(--border-subtle\)/);
    expect(card).toMatch(/border-radius:\s*14px/);
  });

  it('stacks the Profile form cards with a real gutter', () => {
    const form = ruleBody('.profile-settings-form');
    expect(form).toMatch(/display:\s*flex/);
    expect(form).toMatch(/flex-direction:\s*column/);
    expect(form).toMatch(/gap:\s*1\.5rem/);
  });

  it('puts the guide modal bottom gutter inside the scrollable content', () => {
    const guideCard = ruleBody('.modal-card.economy-guide-modal, .modal-card.vdot-guide-modal');
    // Card itself must not rely on its own bottom padding (dropped at scroll end)
    expect(guideCard).toMatch(/padding:\s*1\.5rem 1\.5rem 0\.25rem/);

    const actions = ruleBody('.modal-actions');
    expect(actions).toMatch(/display:\s*flex/);
    expect(actions).toMatch(/justify-content:\s*flex-end/);
    expect(actions).toMatch(/padding-bottom:\s*1\.25rem/);
  });

  it('spaces the guide modal header off the first content block', () => {
    // Both guides use `.modal-card`, which is not a flex container, so they do
    // not inherit the `.modal-content` flex gap. Without this the title sat
    // flush against the formula banner.
    const header = ruleBody('.modal-card.economy-guide-modal > .modal-header, .modal-card.vdot-guide-modal > .modal-header');
    expect(header).toMatch(/margin-bottom:\s*1\.25rem/);
  });

  it('keeps loaders and chart shells styled', () => {
    expect(ruleBody('.loading-state')).toMatch(/background:\s*var\(--bg-base\)/);
    expect(ruleBody('.period-progress-card')).toMatch(/border-radius:\s*14px/);
    expect(ruleBody('.svg-chart-wrapper')).toMatch(/overflow-x:\s*auto/);
  });

  it('never declares a grid track floor wide enough to overflow a 320px phone', () => {
    const offenders: string[] = [];
    const inspect = (source: string, label: string) => {
      for (const m of source.matchAll(/minmax\(\s*(\d+)px\s*,\s*1fr\s*\)/g)) {
        if (Number(m[1]) > 280) offenders.push(`${label}: minmax(${m[1]}px, 1fr)`);
      }
    };

    inspect(css, 'index.css');

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx$/.test(entry.name)) {
          inspect(fs.readFileSync(full, 'utf8'), path.relative(rootDir, full));
        }
      }
    };
    walk(path.join(rootDir, 'src/frontend'));

    expect(offenders).toEqual([]);
  });
});