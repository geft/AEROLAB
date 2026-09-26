import { test, expect } from '@playwright/test';
import { openBrowseFixture } from './browse-fixtures.js';

test('tablet keeps desktop navigation and a two-column Browse layout', async ({ page }) => {
  await openBrowseFixture(page);

  for (const width of [769, 800, 834, 840, 900, 901, 1024]) {
    await page.setViewportSize({ width, height: 1112 });
    await expect(page.locator('.nav-tab-label')).toHaveCount(5);
    for (const label of await page.locator('.nav-tab-label').all()) {
      await expect(label).toBeVisible();
    }
    const columnCount = await page.locator('.browse-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(columnCount).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.setViewportSize({ width: 834, height: 1112 });
  await expect(page.locator('.nav-tab-label')).toHaveCount(5);
  for (const label of await page.locator('.nav-tab-label').all()) {
    await expect(label).toBeVisible();
  }

  const browseGrid = page.locator('.browse-grid');
  const columns = await browseGrid.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);

  for (const button of await page.locator('.nav-tab-btn, .nav-more-trigger-btn, .nav-import-actions .upload-btn').all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await expect(page.locator('.navbar')).toHaveScreenshot('tablet-navbar.png');
  await expect(page.locator('.sidebar-panel')).toHaveScreenshot('tablet-browse-sidebar.png');
  await expect(page.locator('.metric-chips-grid')).toBeVisible();
  await expect(page.locator('.metric-chips-grid')).toHaveScreenshot('tablet-activity-metric-cards.png');

  await page.locator('#tab-progress-btn').click();
  await expect(page.locator('.benchmarks-grid')).toHaveScreenshot('tablet-progress-benchmarks.png');

  await page.locator('#tab-stats-btn').click();
  await expect(page.locator('.volume-kpis-grid')).toHaveScreenshot('tablet-stats-volume-cards.png');

  await page.locator('#tab-profile-btn').click();
  await expect(page.locator('.thresholds-showcase-card')).toHaveScreenshot('tablet-profile-threshold-cards.png');
});
