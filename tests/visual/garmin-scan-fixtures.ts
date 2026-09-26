import { expect, type Page } from '@playwright/test';
import { openBrowseFixture } from './browse-fixtures.js';

export async function openGarminScanFixture(page: Page): Promise<void> {
  await page.route('**/api/ingest/scan', route => route.fulfill({
    json: {
      directory: 'C:/Users/Runner/Downloads',
      results: [
        { status: 'skipped_duplicate', filename: '0924 morning run.csv', activityId: 'run-1', name: 'Singapore Running' },
        { status: 'imported', filename: '0923 interval workout.fit', activityId: 'run-2', name: 'Threshold Repeats' },
        { status: 'skipped_non_running', filename: '0922 wellness.fit' },
        { status: 'error', filename: '0921 damaged export.csv', error: 'Invalid CSV data' }
      ]
    }
  }));
  await openBrowseFixture(page);
  await page.locator('#nav-scan-import-btn').click();
  await expect(page.getByRole('dialog', { name: 'Scan Downloads' })).toBeVisible();
  await expect(page.locator('.garmin-scan-file')).toHaveCount(4);
  await page.evaluate(() => document.fonts.ready);
}
