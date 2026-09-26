import { test, expect } from '@playwright/test';
import { openBrowseFixture } from './browse-fixtures.js';

test('Browse mobile: session sidebar, metric cards, and guide cards', async ({ page }) => {
  await openBrowseFixture(page);

  await expect(page.locator('.sidebar-panel')).toHaveScreenshot('browse-sidebar.png');
  await page.locator('.mobile-browse-segmented-control button').nth(1).click();
  await expect(page.locator('.metric-chips-grid')).toBeVisible();
  await expect(page.locator('.metric-chips-grid')).toHaveScreenshot('activity-metric-cards.png');
  await expect(page.locator('.goal-markers-grid')).toHaveScreenshot('activity-guide-cards.png');
});
