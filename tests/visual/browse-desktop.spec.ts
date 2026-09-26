import { test, expect } from '@playwright/test';
import { openBrowseFixture } from './browse-fixtures.js';

test('Browse desktop: session sidebar, metrics, guide cards, and coach card', async ({ page }) => {
  await openBrowseFixture(page);

  await expect(page.locator('.sidebar-panel')).toHaveScreenshot('browse-sidebar.png');
  await expect(page.locator('.metric-chips-grid')).toHaveScreenshot('activity-metric-cards.png');
  await expect(page.locator('.goal-markers-grid')).toHaveScreenshot('activity-guide-cards.png');

  await page.getByRole('button', { name: 'Analysis' }).click();
  await expect(page.locator('.coach-summary-card')).toHaveScreenshot('coach-summary-card.png');
});
