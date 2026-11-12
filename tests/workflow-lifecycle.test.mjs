import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Engine } from "../src/engine.mjs";
import { plan } from "./workflow-fixtures.mjs";
import { setup, drain } from "./workflow-harness.mjs";
import { canDeliver } from "../src/workflow-policy.mjs";
const wait = () => new Promise((r) => setImmediate(r));
test("MCP 与 fallback 使用同一计划；重复提交与 pump 不重复启动", async () => {
  const f = setup();
  try {
    f.e.workflow.start("a", "幂等");
    const p = plan(1);
    await f.e.action("a", { type: "submit_plan", plan: p });
    const revision = f.e.state("a").cycle.planRevision;
    f.e.teamTokens.set("token", {
      conversation: "a",
      leader: true,
      cycleId: f.e.state("a").cycleId,
      generation: f.e.state("a").cycle.generation,
    });
    await f.e.teamAction("token", { type: "submit_plan", plan: p });
    assert.equal(f.e.state("a").cycle.planRevision, revision);
    for (let i = 0; i < 10; i++) f.e.pump();
    await drain(f.e);
    assert.equal(f.calls.length, 2);
    await f.e.action("a", { type: "finish" });
    assert.equal(
      f.e.state("a").events.filter((e) => e.type === "report").length,
      1,
    );
  } finally {
    f.clean();
  }
});
test("取消、改派和暂停后的迟到结果不推进当前任务", async () => {
  for (const kind of ["cancel", "reassign", "pause"]) {
    const f = setup();
    try {
      f.e.workflow.start("a", kind);
      f.e.workflow.submit("a", plan(1));
      let resolve;
      f.e.model = async () => new Promise((r) => (resolve = r));
      f.e.pump();
      await wait();
      const task = f.e.state("a").cycle.tasks[0];
      if (kind === "pause") f.e.pause("a");
      else await f.e.action("a", { type: kind, task: task.id, member: "r" });
      resolve({
        message: "late",
        completion: "complete",
        summary: "late",
        files: [],
        selfTests: [],
        blockers: "",
        handoff: "",
      });
      await wait();
      await wait();
      assert.notEqual(f.e.state("a").cycle.tasks[0].status, "implemented");
      assert.ok(
        f.e.state("a").events.some((e) => e.type === "workflow_stale_result"),
      );
      if (kind === "reassign") f.e.pause("a");
    } finally {
      f.clean();
    }
  }
});
test("检查与审查阶段重启，只重建隔离 gate，不重复实现或唤醒负责人", async () => {
  for (const stage of ["check", "model"]) {
    const f = setup();
    try {
      f.e.workflow.start("a", "恢复");
      f.e.workflow.submit("a", plan(1));
      await f.e.workflow.step("a");
      if (stage === "model") await f.e.workflow.step("a");
      const g = f.e.state("a").cycle.gates.find((g) => g.kind === stage);
      f.e.workflow.gate("a", g.id, { status: "running" });
      f.e.workflow.update("a", {
        phase: stage === "check" ? "validating" : "reviewing",
      });
      const restored = new Engine(
        f.e.store,
        f.e.config,
        () => {},
        () => {},
      );
      restored.model = f.e.model;
      restored.wake = () => assert.fail("不应唤醒负责人");
      restored.resume("a");
      await drain(restored);
      assert.equal(restored.state("a").status, "done");
      assert.equal(f.calls.filter((c) => c.purpose === "execute").length, 1);
      restored.shutdown();
    } finally {
      f.clean();
    }
  }
});
test("公共约定检查点只阻塞关联任务，用户决定绑定具体任务", async () => {
  const f = setup();
  try {
    const p = plan(3, "checkpoint_plus_final");
    p.tasks[2].dependsOn = [];
    p.gates.push({
      ...p.gates[0],
      id: "cp",
      phase: "checkpoint",
      afterTasks: ["t0"],
      assumption: "接口成立",
      commands: [
        `node -e "require('node:assert/strict').equal(require('node:fs').readFileSync('src/t0.txt','utf8'),'实现0')"`,
      ],
    });
    p.tasks[1].gateIds = ["cp"];
    f.e.workflow.start("a", "检查点");
    f.e.workflow.submit("a", p);
    await f.e.action("a", {
      type: "ask",
      question: "授权?",
      yes: "允许",
      no: "拒绝",
      taskIds: ["t1"],
      gateIds: ["cp"],
    });
    await drain(f.e);
    const x = f.e.state("a").cycle;
    assert.equal(x.tasks.find((t) => t.localId === "t0").status, "implemented");
    assert.equal(x.tasks.find((t) => t.localId === "t2").status, "implemented");
    assert.equal(x.tasks.find((t) => t.localId === "t1").status, "queued");
    assert.equal(canDeliver(x, f.e.state("a").questions), false);
    const q = f.e.state("a").questions[0];
    f.e.event("a", "answer", { id: q.id, answer: true, cycleId: x.cycleId });
    await drain(f.e);
    assert.equal(f.e.state("a").status, "done");
  } finally {
    f.clean();
  }
});
test("已交付追加目标创建新 cycle；显式状态查询不唤醒或改动计划", async () => {
  const f = setup();
  try {
    f.e.workflow.start("a", "旧");
    f.e.workflow.submit("a", plan(1, "checks_only"));
    await drain(f.e);
    const old = f.e.state("a").cycleId;
    const count = f.calls.length;
    await f.e.message("a", "当前进度", [], { intent: "status" });
    assert.equal(f.calls.length, count);
    assert.equal(f.e.state("a").cycleId, old);
    f.e.wake = async () => {};
    await f.e.message("a", "新增目标");
    assert.notEqual(f.e.state("a").cycleId, old);
    assert.equal(f.e.state("a").cycle.evidence.length, 0);
    assert.equal(f.e.state("a").cycles.length, 2);
    assert.equal(canDeliver(f.e.state("a").cycle), false);
  } finally {
    f.clean();
  }
});
test("计划错误先拒绝，无半执行任务；finish 与自动交付同样拒绝未验证", async () => {
  const f = setup();
  try {
    f.e.workflow.start("a", "bad");
    const p = plan();
    p.tasks[0].dependsOn = ["missing"];
    assert.throws(() => f.e.workflow.submit("a", p));
    assert.equal(f.e.state("a").tasks.length, 0);
    await assert.rejects(f.e.action("a", { type: "finish", text: "完成" }));
    assert.throws(() => f.e.workflow.deliver("a"));
    assert.equal(f.calls.length, 0);
  } finally {
    f.clean();
  }
});
test("暂停/429/缺失依赖不计代码返修；改名任务不能绕过批次预算", async () => {
  const f = setup();
  try {
    f.e.workflow.start("a", "budget");
    f.e.workflow.submit("a", plan(1));
    const x = f.e.state("a").cycle;
    f.e.workflow.update("a", {
      budgets: { ...x.budgets, cycleRepairs: 1 },
      repairs: { "renamed-old": 1 },
    });
    const issue = { issueId: "bug", taskId: x.tasks[0].id };
    f.e.workflow.queueRepair("a", [issue], ["e"]);
    assert.equal(f.e.state("a").cycle.phase, "blocked");
    assert.equal(f.e.state("a").cycle.tasks[0].failures, 0);
    assert.equal(f.calls.length, 0);
  } finally {
    f.clean();
  }
});
