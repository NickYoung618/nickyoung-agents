import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import https from "node:https";
import { createServer } from "node:net";
import { Store } from "../../src/store.mjs";
export async function previewService() {
  const dir = mkdtempSync(join(tmpdir(), "ny-preview-service-")),
    data = join(dir, "data"),
    path = join(dir, "project");
  mkdirSync(data);
  cpSync(new URL("../fixtures/embodied", import.meta.url), path, {
    recursive: true,
  });
  const git = (args) =>
    execFileSync("git", ["-C", path, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@localhost",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@localhost",
      },
    }).trim();
  git(["init"]);
  git(["add", "."]);
  git(["commit", "-m", "78b0950e animation regression fixture"]);
  const commit = git(["rev-parse", "HEAD"]);
  const db = new Store(join(data, "events.sqlite"));
  db.append("animation", "created", {
    title: "具身智能动画",
    path,
    status: "done",
  });
  db.append("animation", "project_update", { base: commit, branch: "fixture" });
  db.append("animation", "recruit", {
    id: "leader",
    name: "知行",
    role: "负责人",
    status: "idle",
    model: "fixture",
  });
  db.append("animation", "recruit", {
    id: "worker",
    name: "砚舟",
    role: "执行",
    status: "idle",
    model: "fixture",
  });
  db.append("animation", "report", {
    text: "动画交付，fixture 交付提交 " + commit,
  });
  db.append("other", "created", {
    title: "另一会话",
    path: join(dir, "other"),
    status: "done",
  });
  db.db.close();
  writeFileSync(
    join(data, "config.json"),
    JSON.stringify({
      data,
      workspace: join(dir, "workspace"),
      leader: { channel: "codex", model: "fixture" },
      tiers: [{ id: "main", name: "主力", channel: "codex", model: "fixture" }],
      concurrency: 1,
      timeout: 10000,
      names: [],
    }),
  );
  const free = createServer();
  await new Promise((r) => free.listen(0, "127.0.0.1", r));
  const port = free.address().port;
  await new Promise((r) => free.close(r));
  const fake = join(dir, "model-fixture");
  writeFileSync(
    fake,
    `#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2),schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-stream'}));let i=0;const timer=setInterval(()=>{i++;try{fs.readFileSync('README.md','utf8');}catch{}console.log(JSON.stringify({type:'item.completed',item:{id:'read-'+i,type:'command_execution',command:'cat README.md # visible-'+i,aggregated_output:'fixture read observation',exit_code:0,status:'completed'}}));if(i===(schema.properties.completion&&!schema.properties.verdict?1:125)){clearInterval(timer);const r=schema.properties.completion&&!schema.properties.verdict?{message:'隔离标识用例完成',completion:'complete',summary:'保留初始化文件',files:[],selfTests:[],blockers:'',handoff:''}:{message:'隔离活动流完成',actions:[]};console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(r)}}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:0,output_tokens:0}}));}},40);`,
    { mode: 0o700 },
  );
  const child = spawn(process.execPath, ["src/server.mjs"], {
    env: {
      ...process.env,
      NY_DATA: data,
      NY_CODEX: fake,
      NY_PORT: String(port),
      NY_HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (x) => (log += x));
  child.stderr.on("data", (x) => (log += x));
  const origin = `https://127.0.0.1:${port}`;
  const request = (route, body, cookie) =>
    new Promise((resolve, reject) => {
      const req = https.request(
        origin + route,
        {
          rejectUnauthorized: false,
          method: body === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (x) => chunks.push(x));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: buffer.toString(),
              buffer,
            });
          });
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  let ready = false;
  for (const deadline=Date.now()+20000; Date.now()<deadline;) {
    try {
      await request("/login");
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (!ready) {
    child.kill('SIGTERM');
    if (child.exitCode === null) await new Promise(r=>child.once('close',r));
    rmSync(dir,{recursive:true,force:true});
    throw Error("隔离服务启动失败 " + log);
  }
  const password = readFileSync(join(data, "initial-password"), "utf8").trim(),
    login = await request("/api/login", { password }),
    cookie = login.headers["set-cookie"][0].split(";")[0];
  return {
    dir,
    data,
    path,
    git,
    commit,
    origin,
    password,
    cookie,
    request,
    log: () => log,
    close: async () => {
      child.kill("SIGTERM");
      await new Promise((r) => child.once("close", r));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
