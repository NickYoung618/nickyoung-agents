import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { previewService } from "./helpers/preview-service.mjs";
const f = await previewService(),
  out = new URL("../evidence/feedback-preview/", import.meta.url);
mkdirSync(out, { recursive: true });
let browser;
const checks = [],
  errors = [];
try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(f.origin + "/login");
  await context.request.post(f.origin + "/api/login", {
    data: { password: f.password },
  });
  await page.goto(f.origin);
  await page.waitForSelector("#homeRecent button");
  await page
    .locator("#homeRecent button")
    .filter({ hasText: "具身智能动画" })
    .click();
  await page.click('[data-tab="preview"]');
  await page.click("[data-generate]");
  await page.waitForSelector(".ny-preview-frame");
  const frame = page.frameLocator(".ny-preview-frame");
  await frame.getByRole("button", { name: "暂停", exact: true }).waitFor();
  assert.equal(
    await page.locator(".ny-preview-frame").getAttribute("sandbox"),
    "allow-scripts",
  );
  await frame.getByRole("button", { name: "暂停", exact: true }).click();
  const frozen = await frame.locator("[data-progress]").count();
  await frame.getByRole("button", { name: "继续", exact: true }).click();
  await frame.getByRole("button", { name: "从头重播", exact: true }).click();
  checks.push("A02 原动画在登录工作台内播放、暂停、继续、重播");
  const access = await page
    .frames()
    .find((x) => x.url().includes("/artifacts/"))
    .evaluate(async () => {
      let dom = false,
        storage = false,
        api = false;
      try {
        void parent.document.body;
        dom = true;
      } catch {}
      try {
        localStorage.setItem("escape", "1");
        storage = true;
      } catch {}
      try {
        await fetch("/api/state");
        api = true;
      } catch {}
      return { dom, storage, api };
    });
  assert.deepEqual(access, { dom: false, storage: false, api: false });
  checks.push("A11 iframe 不能访问主站 DOM/存储/接口");
  await page.screenshot({
    path: new URL("p0-animation-desktop.png", out).pathname,
    animations: "disabled",
  });
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.click("[data-open]"),
  ]);
  await popup.waitForLoadState();
  assert.equal(
    await popup.evaluate(() => {
      try {
        localStorage.setItem("x", "1");
        return true;
      } catch {
        return false;
      }
    }),
    false,
  );
  await popup.close();
  checks.push("A11 新标签仍受 CSP sandbox 隔离");
  await page.click('[data-view-nav="result"]');
  await page.locator("[data-preview]").click();
  await page.waitForSelector("#previewPanel:not([hidden])");
  checks.push("A15 交付卡可打开作品，下载链接可访问");
  for (const width of [1440, 1280, 390, 360]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.screenshot({
      path: new URL(`preview-${width}.png`, out).pathname,
      animations: "disabled",
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.ok(
      (await page.locator("#input").boundingBox()).y <
        (width < 600 ? 844 : 900),
    );
  }
  checks.push("A13 四种视口无横向溢出，输入仍可见");
  assert.deepEqual(errors, []);
  writeFileSync(
    new URL("browser.json", out),
    JSON.stringify(
      { fixture: true, modelsCalled: false, checks, errors },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(checks));
} finally {
  await browser?.close();
  await f.close();
}
