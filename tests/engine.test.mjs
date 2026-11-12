import test from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/engine.mjs";
import { Store } from "../src/store.mjs";
function setup() {
  const db = new Store(":memory:");
  const engine = new Engine(
    db,
    { leader: {}, tiers: [{ id: "main", name: "主力", model: "sol" }] },
    () => {},
    () => {},
  );
  engine.event("a", "created", { title: "测试", status: "idle" });
  engine.event("a", "recruit", { id: "leader", name: "知行" });
  return engine;
}
test("未通过的任务阻止收工，遗留任务允许交付", async () => {
  let e = setup();
  e.event("a", "task", { id: "t", status: "review" });
  await assert.rejects(
    e.action("a", { type: "finish", text: "完成" }),
    /未通过/,
  );
  assert.equal(e.state("a").status, "idle");
  await e.action("a", { type: "defer", task: "t", reason: "依赖未就绪" });
  await e.action("a", { type: "finish", text: "交付；遗留依赖" });
  assert.equal(e.state("a").status, "done");
});
test("实现与审查不可为同一人，验收命令不能为空", async () => {
  let e = setup();
  await e.action("a", {
    type: "recruit",
    name: "砚舟",
    role: "实现",
    tier: "main",
  });
  await assert.rejects(
    e.action("a", {
      type: "assign",
      member: "砚舟",
      reviewer: "砚舟",
      title: "接口",
      commands: ["node test.js"],
    }),
    /不同/,
  );
  await e.action("a", {
    type: "recruit",
    name: "青禾",
    role: "审查",
    tier: "main",
  });
  await assert.rejects(
    e.action("a", {
      type: "assign",
      member: "砚舟",
      reviewer: "青禾",
      commands: [],
    }),
    /验收命令/,
  );
  await e.action("a", {
    type: "assign",
    member: "砚舟",
    reviewer: "青禾",
    commands: ["node test.js"],
    title: "接口",
  });
  assert.equal(e.state("a").tasks.length, 1);
});
test("暂停确实停止本对话进程", () => {
  let e = setup(),
    stopped = 0;
  e.running.set("a:member", {
    stop() {
      stopped++;
    },
  });
  e.running.set("b:member", {
    stop() {
      throw Error("不应停止其他对话");
    },
  });
  e.pause("a");
  assert.equal(stopped, 1);
  assert.equal(e.state("a").status, "paused");
});
test("会诊重试门槛与第三次失败停止", async () => {
  let e = setup();
  e.wake = () => {};
  e.event("a", "task", { id: "t", status: "running", failures: 0 });
  e.fail("a", e.state("a").tasks[0], false, "失败1");
  assert.equal(e.state("a").tasks[0].status, "repair");
  e.fail("a", e.state("a").tasks[0], false, "失败2");
  assert.equal(e.state("a").tasks[0].status, "consultation");
  await e.action("a", { type: "retry", task: "t", advice: "具体修复意见" });
  e.fail("a", e.state("a").tasks[0], false, "失败3");
  assert.equal(e.state("a").tasks[0].status, "stopped");
  await assert.rejects(e.action("a", { type: "retry", task: "t" }), /会诊/);
});

test("遗留关闭必须关联已通过审查的替代任务", async () => {
  const e = setup();
  e.event("a", "task", { id: "old", status: "deferred" });
  e.event("a", "task", { id: "new", status: "review" });
  await assert.rejects(
    e.action("a", { type: "resolve", task: "old", replacement: "new" }),
    /已通过审查/,
  );
  e.event("a", "task_update", { id: "new", status: "passed" });
  await e.action("a", {
    type: "resolve",
    task: "old",
    replacement: "new",
    reason: "补审完成",
  });
  assert.equal(e.state("a").tasks[0].status, "resolved");
});

test("非 Git 已有目录等待确认，保留原文件", async () => {
  const { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "ny-existing-"));
  try {
    writeFileSync(join(dir, "original.txt"), "原内容");
    const e = setup();
    const c = await e.create("已有项目", dir);
    assert.equal(e.state(c).status, "waiting_setup");
    assert.equal(e.state(c).questions[0].purpose, "init_repo");
    assert.equal(existsSync(join(dir, ".git")), false);
    await e.message(c, "开发要求");
    assert.equal(e.state(c).status, "waiting_setup");
    e.initialize(c);
    assert.match(e.state(c).branch, /^nickyoung\//);
    assert.equal(readFileSync(join(dir, "original.txt"), "utf8"), "原内容");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("取消正在执行的任务会终止对应成员，不影响其他任务", async () => {
  const e = setup();
  e.event("a", "task", {
    id: "t",
    member: "m",
    reviewer: "r",
    status: "running",
  });
  let stopped = 0;
  e.running.set("a:m", {
    stop() {
      stopped++;
    },
  });
  e.running.set("a:other", {
    stop() {
      throw Error("不能停止其他成员");
    },
  });
  await e.action("a", { type: "cancel", task: "t", reason: "需求改变" });
  assert.equal(stopped, 1);
  assert.equal(e.state("a").tasks[0].status, "cancelled");
});

test("服务恢复保留记录，将中断任务交回负责人", () => {
  const e = setup();
  e.event("a", "project_update", { branch: "nickyoung/test" });
  e.event("a", "status", { status: "working" });
  e.event("a", "task", { id: "t", status: "running", member: "m" });
  const restored = new Engine(
    e.store,
    e.config,
    () => {},
    () => {},
  );
  assert.equal(restored.state("a").status, "interrupted");
  let woke = 0;
  restored.wake = () => {
    woke++;
  };
  restored.pump = () => {};
  restored.recover();
  assert.equal(woke, 1);
  assert.equal(restored.state("a").tasks[0].status, "repair");
  assert.equal(restored.state("a").status, "working");
});

test("讨论最多两轮，超过上限不再调用成员", async () => {
  const e = setup();
  e.event("a", "discussion", { title: "议题", round: 1 });
  e.event("a", "discussion", { title: "议题", round: 2 });
  await assert.rejects(
    e.action("a", { type: "discuss", title: "议题", participants: [] }),
    /最多两轮/,
  );
});

test("请示未回答不能收工，等待期间无关任务仍能调度", async () => {
  const e = setup();
  e.event("a", "status", { status: "working" });
  e.event("a", "question", { id: "q", question: "使用 JSON 吗" });
  await assert.rejects(
    e.action("a", { type: "finish", text: "完成" }),
    /请示等待/,
  );
  e.event("a", "task", {
    id: "t",
    status: "queued",
    member: "m",
    reviewer: "r",
  });
  let started = false;
  e.task = async (c, t) => {
    started = true;
    e.event(c, "task_update", { id: t.id, status: "passed" });
  };
  e.pump();
  await new Promise((r) => setImmediate(r));
  assert.equal(started, true);
  assert.equal(e.state("a").questions[0].answered, false);
  e.event("a", "answer", { id: "q", answer: true });
  await e.action("a", { type: "finish", text: "交付" });
  assert.equal(e.state("a").status, "done");
});
