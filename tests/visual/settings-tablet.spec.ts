import { test, expect } from '@playwright/test';
import { openSettingsFixture } from './browse-fixtures.js';

test('Settings tablet: desktop-like layout remains touch friendly', async ({ page }) => {
  await openSettingsFixture(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const button of await page.locator('.settings-view button').all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(40);
  }
  await expect(page).toHaveScreenshot('settings-page.png', { fullPage: true });
});
