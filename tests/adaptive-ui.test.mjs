import test from "node:test";
import assert from "node:assert/strict";
import {
  progress,
  deliveryEvidence,
  eventText,
} from "../public/studio/event-projection.mjs";
import { studioEdges } from "../public/studio/agent-graph.mjs";
const state = (policy) => ({
  workflowVersion: "adaptive_v1",
  status: "working",
  members: [{ id: "leader" }, { id: "m" }, { id: "r" }],
  tasks: [],
  questions: [],
  events: [],
  cycle: {
    cycleId: "new",
    policy,
    reason: "明确范围",
    phase: "executing",
    tasks: [{ id: "t", status: "implemented" }],
    gates: [
      { id: "check", kind: "check", status: "passed" },
      { id: "review", kind: "model", status: "pending" },
    ],
  },
});
test("实现、检查和免审分开；不把免审称为独立审查通过", () => {
  const s = state("checks_only");
  s.cycle.gates.pop();
  const x = progress(s);
  assert.equal(x.implemented, 1);
  assert.equal(x.checked, 1);
  assert.equal(x.reviewState, "按策略无需模型审查");
  assert.ok(!x.next.includes("独立审查通过"));
  s.cycle.phase = "blocked";
  s.cycle.blockedReason = "检查点等待约定";
  assert.match(progress(s).next, /检查点等待约定/);
  s.status = "paused";
  assert.match(progress(s).action, /已暂停/);
});
test("批次交付证据来自报告快照，旧批次事件不污染新交付", () => {
  const s = state("checks_only");
  s.events = [
    { id: 1, type: "check", data: { passed: true } },
    { id: 2, type: "cycle_review", data: { cycleId: "old" } },
  ];
  const report = {
    id: 20,
    data: {
      cycleId: "new",
      policy: "checks_only",
      tasks: [{ id: "t", status: "implemented" }],
      checks: [{ result: "passed" }],
      reviewCoverage: [],
      finalCommit: "final",
      text: "完成",
    },
  };
  const d = deliveryEvidence(s, report);
  assert.equal(d.passed, 1);
  assert.equal(d.reviews.length, 0);
  assert.equal(d.incomplete.length, 0);
  assert.equal(d.finalCommit, "final");
  assert.equal(d.reviewLabel, "按策略无需模型审查");
  report.data.policy = "final_review";
  report.data.reviewCoverage = [{ coverage: "reviewed_plus_checked_patch" }];
  assert.match(
    deliveryEvidence(s, report).reviewLabel,
    /原提交已审查.*后续补丁/,
  );
});
test("图只显示真实整批交接和局部返修，不制造成功到负责人的交接", () => {
  const s = state("final_review");
  s.events = [
    { id: 1, type: "cycle_review_start", data: { from: "m", to: "r" } },
    {
      id: 2,
      type: "cycle_review",
      data: { reviewer: "r", blockingIssues: [] },
    },
    { id: 3, type: "check", data: { member: "machine", passed: true } },
    {
      id: 4,
      type: "cycle_repair",
      data: { from: "r", to: "m", issueIds: ["bug"] },
    },
  ];
  assert.deepEqual(
    studioEdges(s).map((e) => [e.id, e.from, e.to]),
    [
      [1, "m", "r"],
      [4, "r", "m"],
    ],
  );
  assert.match(eventText(s, s.events[3]), /局部修复/);
});
