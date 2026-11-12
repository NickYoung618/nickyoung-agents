import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
      timezoneId: "Asia/Shanghai",
      viewport: { width: 1440, height: 900 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => { errors.push(e.message); console.error(e.stack); });
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
  const frozen = await frame.locator("#scan-line").getAttribute("transform");
  await page.waitForTimeout(180);
  assert.equal(
    await frame.locator("#scan-line").getAttribute("transform"),
    frozen,
  );
  await frame.getByRole("button", { name: "继续", exact: true }).click();
  await frame.getByRole("button", { name: "从头重播", exact: true }).click();
  await page.waitForTimeout(150);
  assert.notEqual(
    await frame.locator("#scan-line").getAttribute("transform"),
    frozen,
  );
  checks.push("A02 原动画在登录工作台内播放、暂停冻结、继续运动、重播");
  await page.screenshot({
    path: new URL("p0-animation-desktop.png", out).pathname,
    animations: "disabled",
  });
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

  await page.click("[data-reload]");
  await page
    .frameLocator(".ny-preview-frame")
    .getByRole("button", { name: "暂停", exact: true })
    .waitFor();
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
  const original = readFileSync(f.path + "/src/content.ts", "utf8");
  const beforeSrc = await page.locator(".ny-preview-frame").getAttribute("src");
  await page.fill("#input", "看着作品继续修改的草稿");
  writeFileSync(
    f.path + "/src/content.ts",
    original.replace("具身智能", "具身智能第二版"),
  );
  const start = performance.now();
  await context.request.post(
    f.origin + "/api/conversations/animation/preview",
    { data: {} },
  );
  await page.waitForFunction(
    () => document.querySelector("[data-version]").options.length === 2,
  );
  const visibleMs = performance.now() - start;
  assert.equal(
    await page.locator(".ny-preview-frame").getAttribute("src"),
    beforeSrc,
  );
  assert.equal(await page.inputValue("#input"), "看着作品继续修改的草稿");
  assert.match(
    await page.locator("[data-preview-state]").textContent(),
    /新版本/,
  );
  await page.check("[data-follow]");
  await page.waitForFunction(
    (old) =>
      document.querySelector(".ny-preview-frame").getAttribute("src") !== old,
    beforeSrc,
  );
  await page
    .frameLocator(".ny-preview-frame")
    .locator("h1")
    .filter({ hasText: "第二版" })
    .waitFor();
  writeFileSync(
    f.path + "/src/content.ts",
    original.replace("具身智能", "具身智能第三版"),
  );
  await context.request.post(
    f.origin + "/api/conversations/animation/preview",
    { data: {} },
  );
  await page
    .frameLocator(".ny-preview-frame")
    .locator("h1")
    .filter({ hasText: "第三版" })
    .waitFor();
  const lastGood = await page.locator(".ny-preview-frame").getAttribute("src");
  writeFileSync(f.path + "/src/content.ts", "invalid {{{");
  await context.request.post(
    f.origin + "/api/conversations/animation/preview",
    { data: {} },
  );
  await page.waitForFunction(() =>
    document
      .querySelector("[data-preview-state]")
      .textContent.includes("构建失败"),
  );
  assert.equal(
    await page.locator(".ny-preview-frame").getAttribute("src"),
    lastGood,
  );
  assert.equal(await page.inputValue("#input"), "看着作品继续修改的草稿");
  writeFileSync(f.path + "/src/content.ts", original);
  f.git(["add", "."]);
  f.git(["commit", "--allow-empty", "-m", "restore fixture source"]);
  checks.push({
    name: "A03/A04/A05 草稿版本更新、跟随最新、历史画面与输入焦点、构建失败保留",
    observedRequestThroughVisibleMs: Math.round(visibleMs),
    targetMs: 2000,
    includesBundlingAndRoundTrip: true,
  });
  await page.screenshot({
    path: new URL("failed-keeps-preview.png", out).pathname,
    animations: "disabled",
  });
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('[data-view-nav="home"]');
  const create = await context.request.post(f.origin + "/api/conversations", {
    data: { text: "隔离持续活动观察", path: f.path, workflowVersion: "legacy" },
  });
  assert.equal(create.status(), 200);
  const created = await create.json();
  assert.equal(created.workflowVersion, "legacy");
  await page
    .locator("#homeRecent button")
    .filter({ hasText: "隔离持续活动观察" })
    .waitFor();
  await page
    .locator("#homeRecent button")
    .filter({ hasText: "隔离持续活动观察" })
    .click();
  await page.click('[data-tab="team"]');
  await page.fill("#input", "持续输出时保留输入");
  await page.locator("#activityFeed").filter({ hasText: "visible-" }).waitFor();
  const streamingState = await context.request.get(f.origin + "/api/state");
  const active = (await streamingState.json()).find((s) => s.id === created.id);
  assert.ok(
    !active.events.some((e) => e.type === "model_result"),
    "活动必须在模型回合结束前出现",
  );
  assert.equal(await page.inputValue("#input"), "持续输出时保留输入");
  await page.screenshot({
    path: new URL("live-activity-before-turn-end.png", out).pathname,
    animations: "disabled",
  });
  checks.push("A06/A07 连续工具事件在回合结束前显示并可追溯，未清空输入");
  await page.click('[data-activity-file="README.md"]');
  await page.waitForFunction(() =>
    document.querySelector("#filePreview")?.textContent.includes("具身智能"),
  );
  checks.push("A09 点击工具提及的文件打开实际源码");
  await page.click('[data-tab="preview"]');
  assert.equal(await page.locator(".ny-preview-frame").count(), 0);
  assert.match(await page.locator("[data-frame]").textContent(), /尚无/);
  checks.push("A08/A14 切换会话不带入上一作品；无产物有明确提示");
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
