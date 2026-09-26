import { test, expect } from '@playwright/test';
import { openBrowseFixture } from './browse-fixtures.js';

test('mobile navigation stays labeled and touchable', async ({ page }) => {
  await openBrowseFixture(page);

  // The fixture hides the fixed bar to keep component snapshots unobstructed.
  await page.locator('.nav-tabs').evaluate(nav => { (nav as HTMLElement).style.visibility = ''; });

  const tabs = page.locator('.nav-tab-btn');
  await expect(tabs).toHaveCount(5);
  for (const label of await page.locator('.nav-tab-label').all()) {
    await expect(label).toBeVisible();
  }
  for (const tab of await tabs.all()) {
    const box = await tab.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  for (const button of await page.locator('.nav-import-actions .upload-btn').all()) {
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('.nav-tabs')).toHaveScreenshot('mobile-bottom-navigation.png');
});
