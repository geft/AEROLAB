import { test, expect } from '@playwright/test';
import { openBrowseFixture } from './browse-fixtures.js';

test('Activity detail desktop: PM2.5 reading and explanation popup', async ({ page }) => {
  await openBrowseFixture(page);
  const pm25 = page.locator('.weather-pm25-group');
  await expect(pm25).toBeVisible();
  await expect(pm25).toHaveScreenshot('activity-pm25-reading.png');
  await page.getByRole('button', { name: 'About PM2.5' }).click();
  const pm25Dialog = page.getByRole('dialog');
  await expect(pm25Dialog).toBeVisible();
  await expect(pm25Dialog).toHaveScreenshot('activity-pm25-dialog.png');
  await page.getByRole('button', { name: 'Close' }).click();
});

test('Activity detail desktop: telemetry chart and split analysis', async ({ page }) => {
  await openBrowseFixture(page);
  await expect(page.locator('.chart-card canvas')).toBeVisible();
  await expect(page.locator('.chart-card')).toHaveScreenshot('activity-telemetry.png');

  await page.locator('#subtab-splits-btn').click();
  const splits = page.locator('.km-splits-container');
  await expect(splits).toBeVisible();
  await expect(splits).toHaveScreenshot('activity-splits.png');
});
