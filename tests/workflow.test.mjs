import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/engine.mjs";
import { Store } from "../src/store.mjs";
import { plan, members } from "./workflow-fixtures.mjs";
import { setup, drain } from "./workflow-harness.mjs";
test("三任务最小纵向闭环：连续实现、正式检查、整体审查、程序交付", async () => {
  const f = setup();
  try {
    f.e.workflow.start("a", "三任务");
    f.e.workflow.submit("a", plan(3));
    await drain(f.e);
    assert.equal(f.e.state("a").status, "done");
    assert.deepEqual(
      f.calls.map((c) => c.purpose),
      ["execute", "execute", "execute", "review"],
    );
    assert.equal(f.e.state("a").cycle.evidence.length, 1);
    assert.equal(
      f.e.state("a").cycle.tasks.every((t) => t.status === "implemented"),
      true,
    );
    assert.equal(f.e.state("a").cycle.advisories.length, 1);
    f.e.pump();
    await drain(f.e);
    assert.equal(f.calls.length, 4);
  } finally {
    f.clean();
  }
});
test("五任务 auto 规划 1 / 执行 5 / 整体审查 1 / 协调 0", async () => {
  const f = setup();
  try {
    f.e.workflow.start("a", "五任务");
    await f.e.wake("a");
    await drain(f.e);
    assert.equal(f.e.state("a").status, "done");
    assert.deepEqual(
      f.calls.map((c) => c.purpose),
      ["plan", ...Array(5).fill("execute"), "review"],
    );
  } finally {
    f.clean();
  }
});
test("direct 完整配置无规划无审查，自动检查仍真实执行", async () => {
  const f = setup();
  try {
    f.e.workflow.start("a", "direct");
    f.e.workflow.submit("a", plan(1, "checks_only"), { direct: true });
    await drain(f.e);
    assert.equal(f.e.state("a").status, "done");
    assert.deepEqual(
      f.calls.map((c) => c.purpose),
      ["execute"],
    );
    assert.equal(f.e.state("a").cycle.evidence[0].source, "executed");
    assert.equal(f.e.state("a").cycle.reviewedCommit, null);
  } finally {
    f.clean();
  }
});
