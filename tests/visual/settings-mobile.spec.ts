import { test, expect } from '@playwright/test';
import { openSettingsFixture } from './browse-fixtures.js';

test('Settings mobile: controls fit and remain touch friendly', async ({ page }) => {
  await openSettingsFixture(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const button of await page.locator('.settings-view button').all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(40);
  }
  await expect(page).toHaveScreenshot('settings-page.png', { fullPage: true });
});

test('Settings mobile: direct view reflows at 125% text size', async ({ page }) => {
  await openSettingsFixture(page);
  await page.evaluate(() => {
    document.documentElement.dataset.fontSize = 'large';
    return document.fonts.ready;
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const button of await page.locator('.settings-view button').all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(40);
  }
  await page.screenshot({ path: 'test-results/visual/settings-mobile-125.png', fullPage: true });
});
