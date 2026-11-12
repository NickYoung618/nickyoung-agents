import test from "node:test";
import assert from "node:assert/strict";
import { plan } from "./workflow-fixtures.mjs";
import { setup, drain } from "./workflow-harness.mjs";
test("同提交同正式检查实际执行一次；成功来源明确且复用有来源引用", async () => {
  const f = setup();
  try {
    const p = plan(1, "checks_only");
    p.gates.push({ ...p.gates[0], id: "equivalent" });
    f.e.workflow.start("a", "复用");
    f.e.workflow.submit("a", p);
    await drain(f.e);
    const x = f.e.state("a").cycle;
    assert.equal(f.e.state("a").status, "done");
    assert.deepEqual(
      x.evidence.map((e) => e.source),
      ["executed", "reused"],
    );
    assert.equal(x.evidence[1].reusedFrom, x.evidence[0].evidenceId);
    assert.equal(
      f.e.state("a").events.filter((e) => e.type === "command_start").length,
      1,
    );
  } finally {
    f.clean();
  }
});
test("429 排队恢复与暂停分开记录，不消耗代码修复预算", async () => {
  const f = setup();
  try {
    f.e.workflow.start("a", "限流");
    f.e.workflow.submit("a", plan(1, "checks_only"));
    const original = f.e.model;
    let first = true;
    f.e.model = async (...args) => {
      if (first) {
        first = false;
        throw Object.assign(Error("429 rate limit"), {
          retryAt: Date.now() + 1000,
        });
      }
      return original(...args);
    };
    await drain(f.e);
    assert.equal(f.e.state("a").cycle.tasks[0].status, "rate_wait");
    assert.deepEqual(f.e.state("a").cycle.repairs, {});
    assert.equal(f.e.retryTimers.size, 1);
    f.e.pause("a");
    assert.equal(f.e.retryTimers.size, 0);
    f.e.resume("a");
    await drain(f.e);
    assert.equal(f.e.state("a").status, "done");
    assert.deepEqual(f.e.state("a").cycle.repairs, {});
    assert.equal(
      f.e.state("a").events.find((e) => e.type === "workflow_failure").data
        .category,
      "rate_limit",
    );
  } finally {
    f.clean();
  }
});
test("缺失依赖保留诊断与环境阻塞，不反复修改业务代码", async () => {
  const f = setup();
  try {
    const p = plan(1, "checks_only");
    p.gates[0].commands = ["node missing-dependency.mjs"];
    f.e.workflow.start("a", "环境");
    f.e.workflow.submit("a", p);
    await drain(f.e);
    assert.equal(f.e.state("a").cycle.phase, "blocked");
    assert.match(f.e.state("a").cycle.blockedReason, /环境/);
    assert.deepEqual(f.e.state("a").cycle.repairs, {});
    assert.equal(
      f.e.state("a").events.filter((e) => e.type === "environment_diagnostic")
        .length,
      1,
    );
    assert.equal(f.calls.length, 1);
  } finally {
    f.clean();
  }
});
test("不确定高影响疑点仅允许有限范围复查，不静默忽略或无限循环", async () => {
  const f = setup();
  try {
    const original = f.e.model;
    let reviews = 0;
    f.e.model = async (c, m, p, o) => {
      if (o.role === "reviewer") {
        reviews++;
        const d = JSON.parse(p);
        return {
          message: "待确认风险",
          reviewedCommit: d.reviewedCommit,
          criteriaIds: ["c"],
          blockingIssues: [],
          advisories: [],
          needsVerification: [
            {
              issueId: "risk",
              taskId: f.e.state(c).cycle.tasks[0].id,
              criterionId: "c",
              location: "src/t0.txt:1",
              evidence: "尚无法确认的语义风险",
              expected: "约定成立",
              checkIds: [],
              semantic: true,
            },
          ],
        };
      }
      return original(c, m, p, o);
    };
    f.e.workflow.start("a", "疑点");
    f.e.workflow.submit("a", plan(1));
    await drain(f.e);
    assert.equal(reviews, 2);
    assert.equal(f.e.state("a").cycle.rechecks, 1);
    assert.equal(f.e.state("a").cycle.phase, "blocked");
    assert.ok(
      f.e
        .state("a")
        .cycle.issues.some((i) => !i.closed && i.kind === "needs_verification"),
    );
    assert.equal(f.calls.filter((c) => c.purpose === "repair").length, 0);
  } finally {
    f.clean();
  }
});
test("已有旧会话不受新创建开关影响；计划修订保留历史而只调度当前任务", async () => {
  const f = setup();
  try {
    f.e.event("legacy", "created", { path: "/legacy", status: "idle" });
    f.e.config.newWorkflowVersion = "adaptive_v1";
    assert.equal(f.e.state("legacy").workflowVersion, "legacy");
    f.e.workflow.start("a", "计划");
    f.e.workflow.submit("a", plan(2));
    const p = plan(1, "checks_only");
    f.e.workflow.submit("a", p);
    assert.equal(f.e.state("a").cycle.tasks.length, 1);
    assert.equal(f.e.state("a").tasks.length, 2);
    await drain(f.e);
    assert.equal(f.e.state("a").status, "done");
    assert.equal(f.calls.length, 1);
  } finally {
    f.clean();
  }
});

test("授权被拒绝只阻塞关联任务；回执不能被当作许可", async () => {
  const f = setup();
  try {
    const p = plan(2, "checks_only");
    p.tasks[1].dependsOn = [];
    f.e.workflow.start("a", "授权");
    await f.e.action("a", {
      type: "ask",
      questionId: "auth",
      question: "允许外部操作?",
      yes: "允许",
      no: "拒绝",
      authorization: true,
      taskIds: ["t0"],
      gateIds: [],
    });
    p.tasks[0].waitsForQuestions = ["auth"];
    f.e.workflow.submit("a", p);
    const q = f.e.state("a").questions[0];
    f.e.event("a", "answer", { id: q.id, answer: false, cycleId: q.cycleId });
    await drain(f.e);
    assert.equal(
      f.e.state("a").cycle.tasks.find((t) => t.localId === "t0").status,
      "queued",
    );
    assert.equal(
      f.e.state("a").cycle.tasks.find((t) => t.localId === "t1").status,
      "implemented",
    );
    await assert.rejects(f.e.action("a", { type: "finish" }));
  } finally {
    f.clean();
  }
});
test("环境变化先使证据失效并重跑检查，再进行模型审查", async () => {
  const f = setup();
  try {
    f.e.workflow.start("a", "环境失效");
    f.e.workflow.submit("a", plan(1));
    await f.e.workflow.step("a");
    await f.e.workflow.step("a");
    f.e.config.verificationEnvironment = "changed";
    await f.e.workflow.step("a");
    assert.equal(f.calls.filter((c) => c.role === "reviewer").length, 0);
    assert.equal(
      f.e.state("a").cycle.evidence.filter((e) => e.source === "executed")
        .length,
      2,
    );
    assert.ok(
      f.e.state("a").events.some((e) => e.type === "evidence_invalidated"),
    );
    await drain(f.e);
    assert.equal(f.e.state("a").status, "done");
  } finally {
    f.clean();
  }
});
