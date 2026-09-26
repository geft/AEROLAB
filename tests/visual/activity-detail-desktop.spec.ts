import { test, expect } from '@playwright/test';
import { openBrowseFixture } from './browse-fixtures.js';

test('Activity detail desktop: telemetry chart and split analysis', async ({ page }) => {
  await openBrowseFixture(page);
  await expect(page.locator('.chart-card canvas')).toBeVisible();
  await expect(page.locator('.chart-card')).toHaveScreenshot('activity-telemetry.png');

  await page.locator('#subtab-splits-btn').click();
  const splits = page.locator('.km-splits-container');
  await expect(splits).toBeVisible();
  await expect(splits).toHaveScreenshot('activity-splits.png');
});
