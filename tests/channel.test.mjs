import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/engine.mjs";
import { Store } from "../src/store.mjs";
test("通道切换交接上下文，同通道模型变更保留会话，对话覆盖不改全局配置", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ny-channel-")),
    bin = join(dir, "model-fixture"),
    capture = join(dir, "args");
  const saved = {
    codex: process.env.NY_CODEX,
    claude: process.env.NY_CLAUDE,
    capture: process.env.NY_CAPTURE,
  };
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync(process.env.NY_CAPTURE,JSON.stringify(process.argv.slice(2))+'\\n');const r={message:'adapter fixture',actions:[]};if(process.argv.includes('--output-format')){console.log(JSON.stringify({type:'system',session_id:'claude-session'}));console.log(JSON.stringify({type:'result',structured_output:r}));}else{console.log(JSON.stringify({type:'thread.started',thread_id:'codex-session'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(r)}}));}\n`,
    { mode: 0o700 },
  );
  process.env.NY_CODEX = bin;
  process.env.NY_CLAUDE = bin;
  process.env.NY_CAPTURE = capture;
  try {
    const cfg = {
        leader: { channel: "claude", model: "sonnet", effort: "low" },
        timeout: 10000,
        port: 1,
      },
      engine = new Engine(
        new Store(":memory:"),
        cfg,
        () => {},
        () => {},
      );
    engine.event("a", "created", { path: dir, status: "idle" });
    engine.event("a", "recruit", {
      id: "leader",
      name: "知行",
      channel: "claude",
      session: "prior-claude",
      sessionChannel: "claude",
    });
    engine.event("a", "notice", { text: "目标与决定必须交接" });
    engine.event("a", "leader_selection", {
      channel: "codex",
      model: "gpt-6.1-sol",
      effort: "high",
    });
    await engine.model("a", engine.state("a").members[0], engine.context("a"), {
      leader: true,
    });
    let args = readFileSync(capture, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(args[0].includes("resume"), false);
    assert.ok(args[0].at(-1).includes("目标与决定必须交接"));
    assert.equal(cfg.leader.channel, "claude");
    await engine.model("a", engine.state("a").members[0], engine.context("a"), {
      leader: true,
    });
    engine.event("a", "leader_selection", cfg.leader);
    await engine.model("a", engine.state("a").members[0], engine.context("a"), {
      leader: true,
    });
    await engine.model("a", engine.state("a").members[0], engine.context("a"), {
      leader: true,
    });
    args = readFileSync(capture, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(args[1].includes("resume"));
    assert.ok(args[1].includes("codex-session"));
    assert.equal(args[2].includes("--resume"), false);
    assert.ok(args[3].includes("--resume"));
    assert.ok(args[3].includes("claude-session"));
  } finally {
    for (const [key, value] of Object.entries({
      NY_CODEX: saved.codex,
      NY_CLAUDE: saved.claude,
      NY_CAPTURE: saved.capture,
    }))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    rmSync(dir, { recursive: true, force: true });
  }
});
