import https from "node:https";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { Store } from "../src/store.mjs";
import { Engine } from "../src/engine.mjs";
const root = resolve(import.meta.dirname, "..");
const base = JSON.parse(readFileSync(join(root, "data/config.json")));
const data = join(root, "data", "repair-" + Date.now());
mkdirSync(data, { recursive: true });
const config = {
  data,
  port: 18789,
  workspace: base.workspace,
  leader: base.leader,
  tiers: base.tiers.map((t) => ({ ...t, effort: "medium" })),
  names: base.names,
  concurrency: 2,
  timeout: 180000,
  experience: "",
};
const store = new Store(join(data, "events.sqlite"));
let engine,
  c,
  writer,
  deliveries = 0,
  finished = false;
const emit = (e) => {
  if (
    [
      "check",
      "review",
      "task_update",
      "report",
      "error",
      "qa_injection",
    ].includes(e.type)
  )
    console.log(e.type, JSON.stringify(e.data).slice(0, 500));
  if (
    e.conversation === c &&
    e.type === "model_result" &&
    e.data.member === writer
  ) {
    deliveries++;
    if (deliveries <= 2) {
      const code =
        deliveries === 1
          ? "export function add(a,b=0){return a-b;}\n"
          : "export function add(a,b){return a+b;}\n";
      writeFileSync(join(engine.state(c).path, "add.mjs"), code);
      engine.event(c, "qa_injection", {
        delivery: deliveries,
        defect:
          deliveries === 1
            ? "计算减法，机器验收可发现"
            : "默认参数缺失，交由实际审查发现",
      });
    }
  }
  if (
    e.conversation === c &&
    e.type === "status" &&
    ["done", "error"].includes(e.data.status)
  ) {
    finished = true;
  }
};
engine = new Engine(store, config, () => {}, emit);
const server = https.createServer(
  { key: readFileSync(base.key), cert: readFileSync(base.cert) },
  async (req, res) => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      let body = "";
      for await (const chunk of req) body += chunk;
      const result = await engine.teamAction(token, JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
    } catch (e) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
  },
);
await new Promise((r) => server.listen(config.port, "127.0.0.1", r));
c = await engine.create("返修闭环验收");
store.append(c, "message", {
  member: "user",
  text: "开发 add.mjs，导出 add(a,b)，b 不传时按 0 处理。不修改已有 test.mjs。程序和审查必须验证结果，修复后交付。",
});
const path = engine.state(c).path;
writeFileSync(
  join(path, "test.mjs"),
  "import test from 'node:test';import assert from 'node:assert/strict';import {add} from './add.mjs';test('两数相加',()=>assert.equal(add(2,3),5));\n",
);
await engine.action(c, {
  type: "notice",
  text: "# 项目须知\n实现 add(a,b)，b 的默认值为 0。保留 test.mjs，验收命令 node --test test.mjs。审查需检查默认参数并亲自运行。",
});
await engine.action(c, {
  type: "recruit",
  name: "砚舟",
  role: "实现",
  tier: "main",
});
await engine.action(c, {
  type: "recruit",
  name: "青禾",
  role: "审查",
  tier: "helper",
});
writer = engine.state(c).members.find((m) => m.name === "砚舟").id;
await engine.action(c, {
  type: "assign",
  member: "砚舟",
  reviewer: "青禾",
  title: "实现加法及默认参数",
  description:
    "创建 add.mjs，导出 add(a,b)，返回两数之和；省略 b 时按 0 计算。保留现有 test.mjs 不修改。验收 node --test test.mjs。审查者必须另行执行 add(2) 检查默认参数。",
  commands: ["node --test test.mjs"],
});
engine.event(c, "status", { status: "working" });
engine.pump();
const deadline = Date.now() + 600000;
while (!finished && Date.now() < deadline)
  await new Promise((r) => setTimeout(r, 1000));
const state = engine.state(c);
writeFileSync(
  join(root, "evidence/repair-events.json"),
  JSON.stringify(state, null, 2),
);
console.log("RESULT", state.status, "deliveries", deliveries);
engine.shutdown();
await new Promise((r) => server.close(r));
if (state.status !== "done" || !state.tasks.some((t) => t.status === "passed"))
  process.exitCode = 1;
