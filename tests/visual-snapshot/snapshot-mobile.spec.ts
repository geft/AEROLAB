import { test, expect } from '@playwright/test';

test('phone reopens the first cached snapshot offline and opens previously unvisited tabs', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByText(/Snapshot exported/)).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
    }
  });
  expect(await page.evaluate(async () => {
    const cache = await caches.open('aerolab-snapshot-data-v1');
    return Boolean(await cache.match('/snapshot.json'));
  })).toBe(true);
  await page.close();
  await context.setOffline(true);
  const reopened = await context.newPage();
  await reopened.goto('/');
  await expect(reopened.getByText(/Snapshot exported/)).toBeVisible();
  for (const [id, selector] of [
    ['tab-progress-btn', '.progress-grid'],
    ['tab-stats-btn', '.stats-grid'],
    ['tab-profile-btn', '.profile-view-container']
  ] as const) {
    await reopened.locator(`#${id}`).click();
    await expect(reopened.locator(selector)).toBeVisible();
  }
});

test('snapshot mobile navigation and activity detail stay read-only', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Snapshot exported/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Sessions \(\d+\)/ })).toBeVisible();

  for (const label of ['Import', 'Scan', 'Settings', 'Save', 'Restore', 'Backup']) {
    await expect(page.getByRole('button', { name: new RegExp(label, 'i') })).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'Telemetry', exact: true }).click();
  await expect(page.locator('.detail-panel h1')).toBeVisible();
  await expect(page.getByTitle('Rename activity or name special race')).toHaveCount(0);
  await expect(page.getByLabel(/refresh weather/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /upload|edit|refresh weather/i })).toHaveCount(0);

  for (const [id, contentSelector] of [
    ['tab-progress-btn', '.progress-grid'],
    ['tab-stats-btn', '.stats-grid'],
    ['tab-profile-btn', '.profile-view-container']
  ] as const) {
    await page.locator(`#${id}`).click();
    await expect(page.locator(contentSelector)).toBeVisible();
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
