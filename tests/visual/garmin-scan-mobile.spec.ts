import { test, expect } from '@playwright/test';
import { openGarminScanFixture } from './garmin-scan-fixtures.js';

test('Garmin scan mobile: filenames stay compact beside short outcome labels', async ({ page }) => {
  await openGarminScanFixture(page);

  const firstFile = page.locator('.garmin-scan-file').first();
  const filename = await firstFile.locator('.garmin-scan-file-name').boundingBox();
  const outcome = await firstFile.locator('.garmin-scan-file-status').boundingBox();
  expect(filename?.width).toBeGreaterThan(120);
  expect(Math.abs((outcome?.y ?? 0) - (filename?.y ?? 0))).toBeLessThan(6);
  await expect(firstFile.locator('.garmin-scan-file-status')).toHaveText('Duplicate');
  await expect(firstFile.locator('.garmin-scan-activity-name')).toHaveCount(0);

  await expect(page.locator('.garmin-scan-modal')).toHaveScreenshot('garmin-scan-results.png');
});
