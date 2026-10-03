import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { readStylesheet } from '../fixtures/styles.js';

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
  const css = readStylesheet(cssPath);

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

  it('keeps chart selection details accessible on touch and hover-driven on desktop', () => {
    expect(ruleBody('.chart-point-selector input')).toMatch(/min-height:\s*44px/);
    expect(ruleBody('.training-load-axis-label, .threshold-chart-axis-label, .period-chart-axis-label'))
      .toMatch(/font-size:\s*0\.72rem\s*!important/);
    expect(ruleBody('.threshold-trend-tooltip')).toMatch(/position:\s*static\s*!important/);
    expect(ruleBody('.period-metrics-grid')).toMatch(/background:\s*var\(--bg-card-hover\)/);
    expect(css).toMatch(/@media\s*\(hover:\s*hover\)\s+and\s*\(pointer:\s*fine\)[\s\S]*?\.chart-point-selector,\s*\.telemetry-chart-sample-control\s*\{\s*display:\s*none/s);
    expect(css).toMatch(/@media\s*\(hover:\s*hover\)\s+and\s*\(pointer:\s*fine\)\s+and\s*\(min-width:\s*769px\)[\s\S]*?\.threshold-trend-tooltip\s*\{[^}]*position:\s*absolute\s*!important[^}]*width:\s*min\(17rem/s);
    expect(ruleBody('.period-chart-selection-slot')).toMatch(/min-height:\s*3rem/);
    expect(ruleBody('.period-progress-svg .period-chart-axis-label')).toMatch(/font-size:\s*0\.82rem\s*!important/);
    expect(ruleBody('.period-progress-svg .period-chart-data-label, .period-progress-svg .period-chart-point-value'))
      .toMatch(/font-size:\s*0\.78rem\s*!important/);
  });

  it('keeps split telemetry compact and profile zone headers aligned at larger font sizes', () => {
    expect(ruleBody('.split-heart-rate')).toMatch(/justify-self:\s*end/);
    expect(ruleBody('.split-telemetry')).toMatch(/flex-wrap:\s*wrap/);
    expect(ruleBody('.profile-training-zone-header')).toMatch(/justify-content:\s*space-between/);
    expect(ruleBody('.profile-training-zone-title')).toMatch(/white-space:\s*nowrap/);
    expect(ruleBody('.profile-training-zone-range')).toMatch(/white-space:\s*nowrap/);
    expect(ruleBody('.goal-card-header > svg')).toMatch(/flex:\s*0 0 auto/);
    expect(ruleBody('.goal-card-title')).toMatch(/min-width:\s*0/);
  });

  it('makes the custom month picker and mobile training chart independently scrollable', () => {
    expect(ruleBody('.month-picker-dialog')).toMatch(/max-height:\s*min\(80dvh, 42rem\)/);
    expect(ruleBody('.month-picker-options')).toMatch(/overflow-y:\s*auto/);
    expect(css).toMatch(/\.training-load-chart-scroll\s*\{[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.training-load-chart\s*\{[^}]*width:\s*700px\s*!important/s);
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
