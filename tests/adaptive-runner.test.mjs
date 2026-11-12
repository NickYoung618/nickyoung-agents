import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/engine.mjs";
import { Store } from "../src/store.mjs";
import { plan } from "./workflow-fixtures.mjs";
import { drain } from "./workflow-harness.mjs";
test("实际 CLI 适配器：auto 含分流规划；角色 schema、权限、独立会话和 runId 关联", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ny-adapter-")),
    bin = join(dir, "fixture"),
    capture = join(dir, "capture"),
    prior = process.env.NY_CODEX;
  const p = plan(3);
  p.tasks.forEach((t) => (t.executorId = "实现"));
  p.gates.find((g) => g.kind === "model").reviewerId = "审查";
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({args:args.slice(0,-1),schema})+'\\n');const raw=args.at(-1),data=JSON.parse(raw.slice(raw.lastIndexOf('\\n{')+1));let r;
if(schema.properties.recruits)r={message:'fixture plan',actions:[],recruits:[{name:'实现',role:'执行',tier:'main'},{name:'审查',role:'审查',tier:'main'}],plan:${JSON.stringify(p)}};
else if(schema.properties.completion){fs.mkdirSync('src',{recursive:true});fs.writeFileSync(path.join('src',data.task.localId+'.txt'),data.task.title);r={message:'fixture implement',completion:'complete',summary:data.task.title,files:['src/'+data.task.localId+'.txt'],selfTests:[],blockers:'',handoff:'node cli.mjs'};}
else r={message:'fixture review',reviewedCommit:data.reviewedCommit,criteriaIds:['c'],blockingIssues:[],advisories:[],needsVerification:[]};
console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-session'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(r)}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:5,cached_input_tokens:2}}));\n`,
    { mode: 0o700 },
  );
  process.env.NY_CODEX = bin;
  const cfg = {
    data: join(dir, "data"),
    workspace: join(dir, "workspace"),
    port: 1,
    concurrency: 1,
    timeout: 10000,
    leader: { channel: "codex", model: "same-strong", effort: "high" },
    tiers: [
      { id: "main", channel: "codex", model: "same-strong", effort: "high" },
    ],
  };
  const e = new Engine(
    new Store(":memory:"),
    cfg,
    () => {},
    () => {},
  );
  try {
    const c = await e.create("三任务", undefined, {
      workflowVersion: "adaptive_v1",
    });
    await e.message(c, "连续实现");
    await drain(e);
    const s = e.state(c);
    assert.equal(
      s.status,
      "done",
      JSON.stringify(
        s.events.filter((e) => ["error", "workflow_blocked"].includes(e.type)),
      ),
    );
    const starts = s.events.filter((e) => e.type === "run_start");
    assert.deepEqual(
      starts.map((e) => e.data.purpose),
      ["plan", "execute", "execute", "execute", "review"],
    );
    assert.equal(new Set(starts.map((e) => e.data.runId)).size, 5);
    for (const start of starts) {
      assert.equal(
        s.events.filter(
          (e) => e.type === "model_result" && e.data.runId === start.data.runId,
        ).length,
        1,
      );
      assert.ok(start.data.trigger);
      assert.ok(start.data.cycleId);
    }
    assert.ok(
      starts
        .filter((e) => e.data.role !== "planner")
        .every((e) => e.data.scheduleId),
    );
    const argv = readFileSync(capture, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.ok(argv.every(({ args }) => !args.includes("resume")));
    assert.ok(argv[1].args.includes("workspace-write"));
    assert.ok(argv.at(-1).args.includes("read-only"));
    assert.ok(argv[1].schema.properties.completion);
    assert.equal(argv[1].schema.properties.verdict, undefined);
    assert.ok(argv.at(-1).schema.properties.blockingIssues);
    assert.ok(
      s.events.some((e) => e.type === "command_start" && e.data.commandId),
    );
    assert.equal(s.cycle.evidence[0].source, "executed");
  } finally {
    e.shutdown();
    e.store.db.close();
    if (prior === undefined) delete process.env.NY_CODEX;
    else process.env.NY_CODEX = prior;
    rmSync(dir, { recursive: true, force: true });
  }
});
