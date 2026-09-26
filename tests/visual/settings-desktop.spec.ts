import { test, expect } from '@playwright/test';
import { openSettingsFixture } from './browse-fixtures.js';

test('Settings desktop: database, Garmin import, backups, and appearance', async ({ page }) => {
  await openSettingsFixture(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot('settings-page.png', { fullPage: true });
});
