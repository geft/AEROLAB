import { test, expect } from '@playwright/test';
import { openUploadFixture } from './browse-fixtures.js';

test('Upload desktop: file selection and overwrite guidance', async ({ page }) => {
  await openUploadFixture(page);
  await expect(page.locator('.drop-area-large')).toBeVisible();
  await expect(page.locator('.modal-content')).toHaveScreenshot('upload-modal.png');
});
