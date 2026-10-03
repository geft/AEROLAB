import { describe, it, expect } from 'vitest';
import path from 'path';
import { readStylesheet } from '../fixtures/styles.js';

/**
 * Guards the shared secondary-button styling. "Show All in Chart" and similar
 * pagination actions use `.outline-btn`; without this rule the browser falls back
 * to its unstyled default (square corners, off-theme colours).
 */
describe('Shared outline button style', () => {
  const css = readStylesheet(path.resolve(process.cwd(), 'src/frontend/styles/index.css'));

  const blockFor = (selector: string): string => {
    const match = css.match(new RegExp(`^\\${selector}\\s*\\{([^}]*)\\}`, 'm'));
    expect(match, `Missing ${selector} rule in index.css`).toBeTruthy();
    return match![1];
  };

  it('defines .outline-btn as a themed rounded companion to .primary-btn', () => {
    const outline = blockFor('.outline-btn');
    const primary = blockFor('.primary-btn');

    const radiusOf = (block: string) => block.match(/border-radius:\s*([^;]+);/)?.[1].trim();

    expect(radiusOf(outline)).toBeTruthy();
    expect(radiusOf(outline)).toBe(radiusOf(primary));
    expect(outline).toMatch(/border:\s*1px solid var\(--border-subtle\)/);
    expect(outline).toMatch(/padding:/);
    expect(outline).toMatch(/cursor:\s*pointer/);
    expect(outline).toMatch(/font-family:\s*var\(--font-heading\)/);
  });

  it('keeps a hover feedback state for the outlined button', () => {
    const hover = blockFor('.outline-btn:hover');
    expect(hover).toMatch(/border-color:\s*var\(--accent-cyan\)/);
  });
});
