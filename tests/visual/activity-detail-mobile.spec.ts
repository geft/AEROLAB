import { test, expect } from '@playwright/test';
import { openBrowseFixture } from './browse-fixtures.js';

test('Activity detail mobile: telemetry and splits stay readable', async ({ page }) => {
  await openBrowseFixture(page);
  await page.locator('.mobile-browse-segmented-control button').nth(1).click();
  await expect(page.locator('.chart-card canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('header.navbar').evaluate(header => header.remove());
  await expect(page.locator('.chart-card')).toHaveScreenshot('activity-telemetry.png');

  await page.locator('#subtab-splits-btn').click();
  const splits = page.locator('.km-splits-container');
  await expect(splits).toBeVisible();
  await expect(splits).toHaveScreenshot('activity-splits.png');
});
