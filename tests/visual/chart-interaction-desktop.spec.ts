import { test, expect } from '@playwright/test';
import { openBrowseFixture } from './browse-fixtures.js';

test('run chart draws in the browser and reports the hovered sample', async ({ page }) => {
  await openBrowseFixture(page);
  const canvas = page.locator('.chart-card canvas');
  await expect(canvas).toBeVisible();
  const drawing = await canvas.evaluate(element => {
    const node = element as HTMLCanvasElement;
    const ctx = node.getContext('2d');
    if (!ctx) return { width: node.width, height: node.height, paintedPixels: 0 };
    const pixels = ctx.getImageData(0, 0, node.width, node.height).data;
    let paintedPixels = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) paintedPixels++;
    return { width: node.width, height: node.height, paintedPixels };
  });
  expect(drawing.width).toBeGreaterThan(0);
  expect(drawing.height).toBeGreaterThan(0);
  expect(drawing.paintedPixels).toBeGreaterThan(0);

  const wrapper = page.locator('.chart-canvas-wrapper');
  const box = await wrapper.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.locator('.chart-card')).toContainText('4.20 km');
  await expect(page.locator('.chart-card')).toContainText('139 bpm');
});
