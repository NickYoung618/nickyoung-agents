import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Engine } from "../src/engine.mjs";
import { Store } from "../src/store.mjs";
test("限流记录真实恢复时间，恢复后续跑，暂停清理重试", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ny-rate-")),
    bin = join(dir, "fixture"),
    count = join(dir, "count"),
    prior = process.env.NY_CODEX;
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nconst fs=require('node:fs'),p=${JSON.stringify(count)};if(!fs.existsSync(p)){fs.writeFileSync(p,'1');console.log(JSON.stringify({type:'rate_limit_event',rate_limit_info:{status:'rejected',resetsAt:Math.floor(Date.now()/1000)+2}}));console.log(JSON.stringify({type:'result',is_error:true,result:'Rate limit reached'}));process.exit(1);}console.log(JSON.stringify({type:'thread.started',thread_id:'recovered'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({message:'adapter fixture',actions:[]})}}));\n`,
    { mode: 0o700 },
  );
  process.env.NY_CODEX = bin;
  const e = new Engine(
    new Store(":memory:"),
    {
      leader: { channel: "codex", model: "gpt-6.1-sol", effort: "high" },
      timeout: 5000,
      port: 1,
    },
    () => {},
    () => {},
  );
  try {
    e.event("a", "created", { path: dir, status: "working" });
    e.event("a", "recruit", { id: "leader", name: "知行" });
    await e.wake("a");
    let s = e.state("a");
    assert.ok(s.events.some((x) => x.type === "rate_limit"));
    assert.equal(s.status, "working");
    assert.equal(e.retryTimers.size, 1);
    const deadline = Date.now() + 5000;
    while (
      !e.state("a").events.some((x) => x.type === "model_result") &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 25));
    s = e.state("a");
    assert.equal(s.events.filter((x) => x.type === "run_start").length, 2);
    assert.equal(s.events.filter((x) => x.type === "model_result").length, 1);
    e.retry("a", "test", Date.now() + 2000, () =>
      assert.fail("暂停后不应继续"),
    );
    e.pause("a");
    assert.equal(e.retryTimers.size, 0);
  } finally {
    e.shutdown();
    if (prior === undefined) delete process.env.NY_CODEX;
    else process.env.NY_CODEX = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});
