import test from "node:test";
import assert from "node:assert/strict";
import { evaluationOptions, evaluate } from "../scripts/evaluate-workflow.mjs";
import { cases } from "../scripts/evaluation-suite.mjs";
test("真实评估默认不调用模型；live 必须明确预算与现有配置", async () => {
  assert.equal((await evaluate(evaluationOptions([]))).status, "not_run");
  for (const args of [
    ["--live"],
    ["--live", "--budget-turns", "5"],
    ["--live", "--budget-turns", "0", "--budget-ms", "10", "--config", "x"],
  ])
    assert.throws(() => evaluationOptions(args));
  assert.equal(
    evaluationOptions([
      "--live",
      "--budget-turns",
      "20",
      "--budget-ms",
      "60000",
      "--config",
      "x",
    ]).turns,
    20,
  );
  assert.equal(cases.length, 6);
  assert.equal(new Set(cases.map((c) => c.type)).size, 6);
  for (const c of cases) {
    assert.ok(c.acceptance.includes("assert"));
    assert.ok(Object.keys(c.files).length);
  }
});

test("比较评估夹具：相同初始提交和固定外部验收，调用预算受程序限制", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Engine } = await import("../src/engine.mjs");
  const { randomUUID } = await import("node:crypto");
  const { plan } = await import("./workflow-fixtures.mjs");
  const dir = mkdtempSync(join(tmpdir(), "ny-eval-test-")),
    config = join(dir, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      leader: { channel: "codex", model: "fixture" },
      tiers: [{ id: "main", channel: "codex", model: "fixture" }],
      timeout: 5000,
    }),
  );
  class FixtureEngine extends Engine {
    async model(c, m, prompt, opts = {}) {
      const s = this.state(c),
        data = JSON.parse(prompt),
        trace = {
          runId: randomUUID(),
          cycleId: opts.cycleId,
          role: opts.role,
          purpose: opts.purpose || "execute",
          trigger: "evaluation_fixture",
          member: m.id,
          model: "fixture",
        };
      this.event(c, "run_start", trace);
      let result;
      if (opts.leader && s.workflowVersion === "legacy")
        result =
          s.tasks[0]?.status === "passed"
            ? { message: "交付", actions: [{ type: "finish", text: "完成" }] }
            : {
                message: "规划",
                actions: [
                  { type: "recruit", name: "实现", role: "实现", tier: "main" },
                  { type: "recruit", name: "审查", role: "审查", tier: "main" },
                  {
                    type: "assign",
                    member: "实现",
                    reviewer: "审查",
                    title: "修复 double",
                    description: "有限数值翻倍",
                    commands: ["node --check src/math.mjs"],
                  },
                ],
              };
      else if (opts.role === "planner") {
        const p = plan(1);
        p.tasks[0].executorId = "实现";
        p.gates[1].reviewerId = "审查";
        p.gates[0].commands = ["node --check src/math.mjs"];
        result = {
          message: "规划",
          actions: [],
          recruits: [
            { name: "实现", role: "实现", tier: "main" },
            { name: "审查", role: "审查", tier: "main" },
          ],
          plan: p,
        };
      } else if (opts.role === "reviewer")
        result = {
          message: "审查",
          reviewedCommit: data.reviewedCommit,
          criteriaIds: ["c"],
          blockingIssues: [],
          advisories: [],
          needsVerification: [],
        };
      else if (data.review)
        result = { message: "审查", verdict: "pass", issues: [] };
      else {
        mkdirSync(join(s.path, "src"), { recursive: true });
        writeFileSync(
          join(s.path, "src/math.mjs"),
          "export const double=x=>x*2;\n",
        );
        result = {
          message: "实现",
          completion: "complete",
          summary: "修复 double",
          files: ["src/math.mjs"],
          selfTests: [],
          blockers: "",
          handoff: "导入 double",
        };
      }
      this.event(c, "model_result", { ...trace, result, duration: 1 });
      return result;
    }
  }
  try {
    const result = await evaluate({
      live: true,
      turns: 10,
      ms: 45000,
      config,
      output: join(dir, "result"),
      repeats: 1,
      suite: [cases[0]],
      EngineClass: FixtureEngine,
    });
    assert.equal(result.status, "complete");
    const report = JSON.parse(
      readFileSync(join(dir, "result/evaluation.json"), "utf8"),
    );
    assert.equal(report.results.length, 3);
    assert.equal(new Set(report.results.map((r) => r.initialCommit)).size, 1);
    assert.ok(
      report.results.every((r) => r.externalAcceptance.status === "passed"),
    );
    assert.ok(report.results.every((r) => r.metrics.length));
    assert.equal(report.calls, 8);
    assert.ok(report.results.every((r) => r.externalAcceptance.duration >= 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
