import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 740 }]) {
  test(`${viewport.width}×${viewport.height} 页面与场景正常`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page).toHaveTitle('具身智能');
    await expect(page.getByRole('heading', { name: '具身智能', exact: true })).toBeVisible();
    await expect(page.locator('svg[data-testid="robot-scene"]')).toBeVisible();
    for (const name of ['感知PERCEIVE', '规划PLAN', '行动ACT', '反馈LEARN']) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    await expect(page.locator('[data-phase]')).toHaveCount(4);
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
    const screenshotPath = testInfo.outputPath('page.png');
    const errorsPath = testInfo.outputPath('browser-errors.json');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await writeFile(errorsPath, JSON.stringify(errors, null, 2));
    await testInfo.attach('page', { path: screenshotPath, contentType: 'image/png' });
    await testInfo.attach('browser-errors', { path: errorsPath, contentType: 'application/json' });
    expect(errors, '浏览器不得出现未捕获异常或控制台错误').toEqual([]);
  });
}
