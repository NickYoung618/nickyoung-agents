import test from "node:test";
import assert from "node:assert/strict";
import { cycleStatistics } from "../src/statistics.mjs";
test("runId 去重、用途、未知用量与墙钟分别统计", () => {
  const events = [
    {
      type: "run_start",
      time: "2026-01-01T00:00:00Z",
      data: { runId: "1", cycleId: "c", purpose: "execute", waitDuration: 4 },
    },
    {
      type: "model_result",
      time: "2026-01-01T00:00:01Z",
      data: {
        runId: "1",
        cycleId: "c",
        purpose: "execute",
        duration: 1000,
        usage: { input_tokens: 20, output_tokens: 5, cached_input_tokens: 3 },
      },
    },
    {
      type: "run_start",
      time: "2026-01-01T00:00:00Z",
      data: { runId: "2", cycleId: "c", purpose: "review" },
    },
    {
      type: "run_failed",
      time: "2026-01-01T00:00:01Z",
      data: { runId: "2", cycleId: "c", purpose: "review", duration: 1000 },
    },
    {
      type: "run_interrupted",
      time: "2026-01-01T00:00:02Z",
      data: {
        runId: "3",
        cycleId: "c",
        purpose: "repair",
        duration: 500,
        usage: { input_tokens: 2 },
      },
    },
  ];
  const [s] = cycleStatistics([{ events: [...events, events[1]] }]);
  assert.equal(s.calls.execute, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.interrupted, 1);
  assert.equal(s.usageKnown, 1);
  assert.equal(s.usageUnknown, 2);
  assert.equal(s.input, 22);
  assert.equal(s.output, 5);
  assert.equal(s.cached, 3);
  assert.equal(s.wallDuration, 2000);
  assert.equal(s.modelDuration, 2500);
});

test("真实适配器失败与暂停均保留 runId 和已知部分 usage", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Engine } = await import("../src/engine.mjs");
  const { Store } = await import("../src/store.mjs");
  const dir = mkdtempSync(join(tmpdir(), "ny-trace-")),
    bin = join(dir, "fixture"),
    prior = process.env.NY_CODEX;
  const e = new Engine(
    new Store(":memory:"),
    { concurrency: 1, timeout: 5000 },
    () => {},
    () => {},
  );
  e.event("c", "created", { path: dir, status: "working" });
  e.event("c", "recruit", { id: "m", model: "fixture", channel: "codex" });
  process.env.NY_CODEX = bin;
  try {
    writeFileSync(
      bin,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:3}}));process.exit(7);\n`,
      { mode: 0o700 },
    );
    await assert.rejects(
      e.model("c", e.state("c").members[0], "fixture", {
        cycleId: "cycle",
        purpose: "execute",
        trigger: "test",
      }),
    );
    writeFileSync(
      bin,
      `#!/usr/bin/env node\nconsole.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:4}}));setInterval(()=>{},100);\n`,
      { mode: 0o700 },
    );
    const pending = e.model("c", e.state("c").members[0], "fixture", {
      cycleId: "cycle",
      purpose: "repair",
      trigger: "test",
    });
    const rejected = assert.rejects(pending);
    const deadline = Date.now() + 5000;
    while (
      Date.now() < deadline &&
      !e
        .state("c")
        .events.some(
          (x) => x.type === "process" && x.data.event.usage?.input_tokens === 4,
        )
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(
      e
        .state("c")
        .events.some(
          (x) => x.type === "process" && x.data.event.usage?.input_tokens === 4,
        ),
    );
    e.pause("c");
    await rejected;
    const s = e.state("c"),
      starts = s.events.filter((e) => e.type === "run_start"),
      ends = s.events.filter((e) =>
        ["run_failed", "run_interrupted"].includes(e.type),
      );
    assert.equal(starts.length, 2);
    assert.equal(ends.length, 2);
    assert.ok(
      ends.every((end) =>
        starts.some((start) => start.data.runId === end.data.runId),
      ),
    );
    const [metrics] = cycleStatistics([s]);
    assert.equal(metrics.failed, 1);
    assert.equal(metrics.interrupted, 1);
    assert.equal(metrics.input, 7);
    assert.equal(metrics.usageUnknown, 2);
  } finally {
    e.shutdown();
    e.store.db.close();
    if (prior === undefined) delete process.env.NY_CODEX;
    else process.env.NY_CODEX = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});
