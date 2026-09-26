import { test, expect } from '@playwright/test';
import { openBrowseFixture } from './browse-fixtures.js';

test('mobile charts stay readable and operable with touch, keyboard, and Chinese', async ({ page }) => {
  await openBrowseFixture(page);
  await page.locator('#tab-progress-btn').evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('.period-chart-card')).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.fontSize = 'large';
  });
  const activeControl = page.locator('.volume-tab-btn.active');
  await expect.poll(() => activeControl.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(3, 105, 161)');
  await expect.poll(() => activeControl.evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');

  const periodSvg = page.locator('.period-progress-svg');
  const trendSvg = page.locator('.threshold-trends-svg');
  expect(await periodSvg.evaluate(svg => svg.getBoundingClientRect().width)).toBeGreaterThanOrEqual(360);
  expect(await trendSvg.evaluate(svg => svg.getBoundingClientRect().width)).toBeGreaterThanOrEqual(700);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const firstPeriod = periodSvg.getByRole('button').first();
  await firstPeriod.focus();
  await firstPeriod.press('Enter');
  await expect(firstPeriod).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.period-chart-selection')).toContainText('Selected period');
  const periodAxisLabel = page.locator('.period-chart-scroll .period-chart-axis-label').first();
  const [axisBox, scrollBox] = await Promise.all([
    periodAxisLabel.boundingBox(),
    page.locator('.period-chart-scroll').boundingBox()
  ]);
  expect(axisBox?.x).toBeGreaterThanOrEqual(scrollBox?.x ?? 0);

  const firstTrendPoint = trendSvg.getByRole('button').first();
  await firstTrendPoint.tap();
  await expect(page.locator('.threshold-trend-tooltip')).toBeVisible();
  await expect(firstTrendPoint).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.threshold-trend-tooltip').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');

  await page.getByRole('button', { name: 'What is Running Economy?' }).click();
  const formulaPill = page.locator('.economy-formula-pill');
  await expect(formulaPill).toBeVisible();
  expect(await formulaPill.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.locator('.modal-close-btn').click();

  await page.locator('.nav-tabs').evaluate(nav => { (nav as HTMLElement).style.visibility = ''; });
  await page.locator('#nav-more-menu-btn').click();
  await page.locator('#more-menu-lang-zh').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
  await page.locator('#tab-browse-btn').click();
  await page.locator('.mobile-browse-tab-btn').nth(1).click();

  await expect(page.locator('.chart-title')).toHaveText('海拔与运动遥测曲线');
  await expect(page.locator('.telemetry-chart-legend')).toContainText('配速');
  await expect(page.locator('.telemetry-chart-legend')).toContainText('心率');
  await expect(page.locator('.telemetry-chart-legend')).toContainText('海拔');

  const sampleSlider = page.locator('.telemetry-chart-sample-control input');
  await expect(sampleSlider).toHaveAttribute('aria-label', '选择跑步图表中的数据点');
  await sampleSlider.focus();
  await sampleSlider.press('ArrowRight');
  await expect(page.locator('.telemetry-chart-readout')).toContainText('距离');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
