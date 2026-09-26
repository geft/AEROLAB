import { test, expect } from '@playwright/test';
import { openBrowseFixture } from './browse-fixtures.js';

test('Progress, Stats, and Profile mobile cards', async ({ page }) => {
  await openBrowseFixture(page);

  await page.locator('#tab-progress-btn').evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('.benchmarks-grid')).toBeVisible();
  await expect(page.locator('.benchmarks-grid')).toHaveScreenshot('progress-benchmarks.png');
  await expect(page.locator('.threshold-trends-card')).toHaveScreenshot('threshold-trends.png');

  await page.locator('#tab-stats-btn').evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('.volume-kpis-grid')).toBeVisible();
  await expect(page.locator('.volume-kpis-grid')).toHaveScreenshot('stats-volume-cards.png');
  await expect(page.locator('.goal-markers-grid')).toHaveScreenshot('stats-guide-cards.png');

  await page.locator('#tab-profile-btn').evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('.thresholds-showcase-card')).toBeVisible();
  await expect(page.locator('.thresholds-showcase-card')).toHaveScreenshot('profile-threshold-cards.png');
  await expect(page.locator('.profile-view-container section.profile-card').last()).toHaveScreenshot('profile-training-zones.png');
});
