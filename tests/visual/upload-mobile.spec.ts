import { test, expect } from '@playwright/test';
import { openUploadFixture } from './browse-fixtures.js';

test('Upload mobile: modal fits the viewport and controls remain reachable', async ({ page }) => {
  await openUploadFixture(page);
  const modal = page.locator('.modal-content');
  await expect(page.locator('.drop-area-large')).toBeVisible();
  const box = await modal.boundingBox();
  expect(box?.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(modal).toHaveScreenshot('upload-modal.png');
});
