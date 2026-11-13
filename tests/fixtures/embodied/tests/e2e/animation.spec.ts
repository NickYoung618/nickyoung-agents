import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Read rendered SVG matrices, independent of the timeline's reported state.
async function point(page: Page, selector: string, x = 0, y = 0) {
  return page.locator(selector).evaluate((element, local) => {
    const svg = element as SVGGraphicsElement;
    const p = new DOMPoint(local.x, local.y).matrixTransform(svg.getCTM()!);
    const root = svg.ownerSVGElement!;
    const world = p.matrixTransform(root.getCTM()!.inverse());
    return { x: world.x, y: world.y };
  }, { x, y });
}
async function visiblePose(page: Page) {
  return page.locator('[data-testid="robot-scene"]').evaluate((svg) => svg.innerHTML);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 740 }]) {
  test(`${viewport.width}×${viewport.height} 两轮闭环与键盘控件`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewportSize(viewport);
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.goto('/');
    const toggle = page.getByRole('button', { name: '暂停', exact: true });
    await expect(toggle).toBeVisible();
    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeVisible();
    const paused = await visiblePose(page);
    await page.clock.runFor(1000);
    expect(await visiblePose(page)).toBe(paused);
    await page.keyboard.press('Enter');
    // Rewind to an exact start; subsequent clock runs render every animation frame.
    await page.getByRole('button', { name: '从头重播' }).click();
    const measurements: unknown[] = [];
    const screenshot = async (name: string) => {
      await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
    };
    const advance = async (ms: number) => { await page.clock.runFor(ms); };
    for (let cycle = 1; cycle <= 2; cycle++) {
      await advance(3000);
      await expect(page.locator('[data-phase="perception"]')).toHaveAttribute('aria-current', 'step');
      await expect(page.locator('#perception-overlay')).toHaveAttribute('opacity', '1');
      const scan = await point(page, '#scan-line');
      await screenshot(`cycle-${cycle}-perception`);
      await advance(6000);
      await expect(page.locator('[data-phase="planning"]')).toHaveAttribute('aria-current', 'step');
      await expect(page.locator('#planned-path')).toHaveAttribute('opacity', '1');
      expect(await point(page, '#scan-line')).not.toEqual(scan);
      await screenshot(`cycle-${cycle}-planning`);
      await advance(6000); // 15s: grasped and lifting
      await expect(page.locator('[data-phase="action"]')).toHaveAttribute('aria-current', 'step');
      const object = await point(page, '#object');
      const gripper = await point(page, '#gripper', 0, 28);
      expect(object.x).toBeCloseTo(gripper.x, 3);
      expect(object.y).toBeCloseTo(gripper.y, 3);
      expect(object.y).toBeLessThan(278);
      const leftFinger = await point(page, '#finger-left');
      const rightFinger = await point(page, '#finger-right');
      expect(rightFinger.x - leftFinger.x).toBeCloseTo(50, 3);
      await screenshot(`cycle-${cycle}-grasp`);
      await advance(4000); // 19s: travelling above table
      const carried = await point(page, '#object');
      const carryingGrip = await point(page, '#gripper', 0, 28);
      expect(carried.x).toBeGreaterThan(object.x + 30);
      expect(carried.y).toBeLessThan(230);
      expect(carried.x).toBeCloseTo(carryingGrip.x, 3);
      expect(carried.y).toBeCloseTo(carryingGrip.y, 3);
      await screenshot(`cycle-${cycle}-transport`);
      // Pause mid-transport: all SVG effects must freeze, then resume smoothly.
      await page.getByRole('button', { name: '暂停', exact: true }).click();
      const frozen = await visiblePose(page);
      const pausedCarried = await point(page, '#object');
      await advance(1600);
      expect(await visiblePose(page)).toBe(frozen);
      await page.getByRole('button', { name: '继续', exact: true }).click();
      expect(await point(page, '#object')).toEqual(pausedCarried);
      await advance(32);
      expect(Math.abs((await point(page, '#object')).x - carried.x)).toBeLessThan(2);
      await advance(7968); // 27s: feedback confirms the placement
      await expect(page.locator('[data-phase="feedback"]')).toHaveAttribute('aria-current', 'step');
      await expect(page.locator('#dynamic-description')).toContainText('目标区');
      await expect(page.locator('#result-check')).toHaveAttribute('opacity', '1');
      await expect(page.locator('#dynamic-description')).toContainText('放置成功');
      const placed = await point(page, '#object');
      expect(placed.x).toBeCloseTo(540, 0);
      expect(placed.y).toBeCloseTo(284, 0);
      expect((await point(page, '#gripper')).y).toBeLessThan(250);
      await screenshot(`cycle-${cycle}-feedback`);
      measurements.push({ cycle, grasp: { object, gripper, leftFinger, rightFinger }, transport: { object: carried, gripper: carryingGrip }, placed });
      await advance(2000);
      expect(await point(page, '#object')).toEqual(placed);
      await advance(1016); // cross full 30s loop, allowing one requestAnimationFrame
      const reset = await point(page, '#object');
      expect(reset.x).toBeCloseTo(441, 0);
      expect(reset.y).toBeCloseTo(278, 0);
      await expect(page.locator('[data-phase="perception"]')).toHaveAttribute('aria-current', 'step');
    }
    await advance(19000);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.getByRole('button', { name: '从头重播' }).focus();
    await page.keyboard.press('Enter');
    expect((await point(page, '#object')).x).toBeCloseTo(441, 0);
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
    await expect(page.locator('#time-display')).toHaveText('00:00 / 00:30');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await writeFile(info.outputPath('browser-errors.json'), JSON.stringify(errors));
    await writeFile(info.outputPath('motion-evidence.json'), JSON.stringify(measurements, null, 2));
    expect(errors).toEqual([]);
  });
}

test('减少动态效果：默认冻结，主动播放与重播可用', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  const start = await visiblePose(page);
  await page.clock.runFor(19000);
  expect(await visiblePose(page)).toBe(start);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.clock.runFor(19000);
  expect((await point(page, '#object')).x).toBeGreaterThan(470);
  await page.getByRole('button', { name: '从头重播' }).click();
  expect((await point(page, '#object')).x).toBeCloseTo(441, 0);
  await writeFile(info.outputPath('browser-errors.json'), JSON.stringify(errors));
  expect(errors).toEqual([]);
});
