import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setup, drain } from "../tests/workflow-harness.mjs";
import { plan } from "../tests/workflow-fixtures.mjs";
import { cycleStatistics } from "../src/statistics.mjs";
const output = resolve(process.argv[2] || "evidence/adaptive/traces");
mkdirSync(output, { recursive: true });
function fixturePlan(name) {
  const p = plan(
    name === "five_tasks"
      ? 5
      : ["three_tasks", "checkpoint"].includes(name)
        ? 3
        : 1,
    ["direct", "auto_checks_only"].includes(name)
      ? "checks_only"
      : name === "checkpoint"
        ? "checkpoint_plus_final"
        : "final_review",
  );
  if (name === "checkpoint") {
    p.gates.push({
      ...p.gates[0],
      id: "contract",
      phase: "checkpoint",
      afterTasks: ["t0"],
      scope: ["src/t0.txt"],
      assumption: "t0 约定存在",
      commands: [
        `node -e "require('node:assert/strict').equal(require('node:fs').readFileSync('src/t0.txt','utf8'),'实现0')"`,
      ],
    });
    p.tasks[1].gateIds = ["contract"];
  }
  return p;
}
const summaries = [];
for (const name of [
  "three_tasks",
  "five_tasks",
  "direct",
  "auto_checks_only",
  "checkpoint",
  "local_repair",
]) {
  const f = setup();
  let firstReview = true;
  const base = f.e.model;
  f.e.model = async (c, member, prompt, options) => {
    const trace = {
      runId: randomUUID(),
      cycleId: options.cycleId,
      taskId: options.taskId,
      gateId: options.gateId,
      scheduleId: options.scheduleId,
      role: options.role,
      purpose: options.purpose,
      trigger: options.trigger,
      model: "controlled-fixture",
      member: member.id,
    };
    const started = Date.now();
    f.e.event(c, "run_start", trace);
    try {
      let result;
      if (options.role === "planner")
        result = {
          message: "受控规划",
          recruits: [],
          actions: [],
          plan: fixturePlan(name),
        };
      else if (
        name === "local_repair" &&
        options.role === "reviewer" &&
        firstReview
      ) {
        firstReview = false;
        result = {
          message: "受控阻塞",
          reviewedCommit: JSON.parse(prompt).reviewedCommit,
          criteriaIds: ["c"],
          blockingIssues: [
            {
              issueId: "fixture-bug",
              taskId: f.e.state(c).cycle.tasks[0].id,
              criterionId: "c",
              location: "src/t0.txt:1",
              evidence: "局部修复路径夹具，不是真实模型缺陷",
              expected: "指定检查成功",
              checkIds: ["check"],
              semantic: false,
            },
          ],
          advisories: [],
          needsVerification: [],
        };
      } else result = await base(c, member, prompt, options);
      f.e.event(c, "model_result", {
        ...trace,
        result,
        duration: Date.now() - started,
      });
      return result;
    } catch (error) {
      f.e.event(c, "run_failed", {
        ...trace,
        error: error.message,
        duration: Date.now() - started,
      });
      throw error;
    }
  };
  try {
    f.e.workflow.start("a", name);
    if (name === "direct")
      f.e.workflow.submit("a", fixturePlan(name), { direct: true });
    else await f.e.wake("a");
    await drain(f.e);
    const s = f.e.state("a");
    if (s.status !== "done") throw Error(name + " 未交付");
    const trace = {
      fixture: true,
      realModels: false,
      formalCommandsActuallyExecuted: true,
      name,
      status: s.status,
      workflowVersion: s.workflowVersion,
      cycleId: s.cycleId,
      metrics: cycleStatistics([s]),
      events: s.events.filter((e) => !["process", "member"].includes(e.type)),
    };
    writeFileSync(join(output, name + ".json"), JSON.stringify(trace, null, 2));
    summaries.push({
      name,
      status: s.status,
      calls: trace.metrics[0].calls,
      checks: s.cycle.evidence.map((e) => ({
        checkId: e.checkId,
        source: e.source,
        result: e.result,
      })),
      reviewedCommit: s.cycle.reviewedCommit,
      finalCommit: s.cycle.finalCommit,
    });
  } finally {
    f.clean();
  }
}
writeFileSync(
  join(output, "summary.json"),
  JSON.stringify({ fixture: true, realModels: false, summaries }, null, 2),
);
console.log(JSON.stringify(summaries, null, 2));
