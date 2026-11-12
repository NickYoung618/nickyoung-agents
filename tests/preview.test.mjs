import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  cpSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/engine.mjs";
import { Store } from "../src/store.mjs";
import { PreviewManager } from "../src/preview-manager.mjs";
import { bundleStatic, safeFile, previewCsp } from "../src/static-preview.mjs";
import { captureRuntime } from "../src/runtime-info.mjs";
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ny-preview-")),
    path = join(dir, "source");
  cpSync(new URL("./fixtures/embodied", import.meta.url), path, {
    recursive: true,
  });
  const e = new Engine(
    new Store(":memory:"),
    { data: join(dir, "data") },
    () => {},
    () => {},
  );
  e.git(path, ["init"]);
  e.git(path, ["add", "."]);
  e.git(path, ["commit", "-m", "fixture 78b0950e"]);
  e.event("c", "created", { path, status: "working" });
  const p = new PreviewManager(e);
  return {
    e,
    p,
    path,
    dir,
    clean: () => {
      e.store.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("P0：真实动画源码转为自包含可执行 HTML；固定产物独立于临时工作区", async () => {
  const f = setup();
  try {
    const commit = f.e.git(f.path, ["rev-parse", "HEAD"]);
    const [a] = await f.p.request("c", {
      sourceCommit: commit,
      buildEvidenceIds: [10],
    });
    assert.ok(a);
    const html = f.p.store.read("c", a.artifactId).data.toString();
    assert.match(html, /具身智能/);
    assert.match(html, /requestAnimationFrame/);
    assert.ok(!html.includes('src="/src/'));
    assert.equal(a.validationStatus, "draft");
    assert.equal(a.sourceCommit, commit);
    assert.equal(a.hasSource, true);
    rmSync(f.path, { recursive: true, force: true });
    assert.match(f.p.store.read("c", a.artifactId).data.toString(), /具身智能/);
    assert.throws(() => f.p.store.get("other", a.artifactId));
  } finally {
    f.clean();
  }
});
test("P0：失败保留上一成功版本；重复成功不新增版本，源码不修改", async () => {
  const f = setup();
  try {
    await f.p.request("c");
    await f.p.request("c");
    assert.equal(f.p.store.list("c").length, 1);
    assert.equal(f.e.git(f.path, ["status", "--porcelain"]), "");
    writeFileSync(join(f.path, "src/main.ts"), "this is invalid {{{");
    await f.p.request("c");
    assert.equal(f.e.state("c").preview.status, "failed");
    assert.equal(f.p.store.list("c").length, 1);
    assert.ok(
      f.p.store.read("c", f.p.store.list("c")[0].artifactId).data.length,
    );
  } finally {
    f.clean();
  }
});
test("P0：路径穿越、符号链接与外部依赖拒绝；预览响应独立 sandbox", async () => {
  const f = setup();
  try {
    writeFileSync(join(f.dir, "private.txt"), "secret");
    assert.throws(() => safeFile(f.path, "../private.txt"));
    symlinkSync(join(f.dir, "private.txt"), join(f.path, "leak.txt"));
    assert.throws(() => safeFile(f.path, "leak.txt"));
    writeFileSync(
      join(f.path, "index.html"),
      '<script src="https://example.com/a.js"></script>',
    );
    await assert.rejects(bundleStatic(f.path), /外部资源/);
    assert.match(previewCsp, /sandbox allow-scripts/);
    assert.ok(!previewCsp.includes("allow-same-origin"));
    assert.match(previewCsp, /connect-src 'none'/);
  } finally {
    f.clean();
  }
});
test("P0：runtime 信息在启动时固定，脏源码不冒充干净 SHA", () => {
  const f = setup();
  try {
    const clean = captureRuntime(f.path);
    assert.equal(clean.dirty, false);
    writeFileSync(join(f.path, "src/main.ts"), "changed");
    const dirty = captureRuntime(f.path);
    assert.equal(dirty.buildCommit, clean.buildCommit);
    assert.equal(dirty.dirty, true);
    assert.notEqual(dirty.contentVersion, clean.contentVersion);
    assert.equal(clean.dirty, false);
  } finally {
    f.clean();
  }
});
test("P1：构建完成即生成草稿；历史版本、单项目合并构建与检查附件长期保留", async () => {
  const f = setup();
  try {
    const commit = f.e.git(f.path, ["rev-parse", "HEAD"]);
    await f.p.completed("c", {
      cwd: f.path,
      command: "npm run build",
      commit,
      buildEvidenceIds: [11],
    });
    assert.equal(f.p.store.list("c")[0].validationStatus, "draft");
    assert.equal(f.p.store.list("c")[0].sourceCommit, commit);
    writeFileSync(
      join(f.path, "src/content.ts"),
      readFileSync(join(f.path, "src/content.ts"), "utf8").replace(
        "具身智能",
        "具身智能第二版",
      ),
    );
    await Promise.all([f.p.request("c"), f.p.request("c"), f.p.request("c")]);
    assert.equal(
      f.p.store.list("c").filter((a) => a.kind === "static_page").length,
      2,
    );
    assert.equal(f.p.active.size, 0);
    mkdirSync(join(f.path, "test-results"), { recursive: true });
    writeFileSync(join(f.path, "test-results", "browser-errors.json"), "[]");
    f.p.collectEvidence("c", f.path, commit);
    const evidence = f.p.store.list("c").find((a) => a.kind === "evidence");
    assert.ok(evidence);
    rmSync(join(f.path, "test-results"), { recursive: true });
    assert.equal(
      f.p.store.read("c", evidence.artifactId).data.toString(),
      "[]",
    );
  } finally {
    f.clean();
  }
});
test("P1：inline_preview 的交付入口要求同提交产物；程序生成后再交付，不额外调用负责人", async () => {
  const f = setup();
  try {
    const { plan } = await import("./workflow-fixtures.mjs");
    const { drain } = await import("./workflow-harness.mjs");
    for (const id of ["m", "r"]) f.e.event("c", "recruit", { id, name: id });
    f.e.previews = f.p;
    let calls = 0;
    f.e.model = async (c, m, p, o) => {
      calls++;
      assert.equal(o.role, "executor");
      return {
        message: "使用既有动画回归输入",
        completion: "complete",
        summary: "完成交付绑定",
        files: [],
        selfTests: [],
        blockers: "",
        handoff: "工作台预览",
      };
    };
    f.e.event("c","project_update",{workflowVersion:"adaptive_v1"});
    f.e.workflow.start("c", "直接打开动画");
    const p = plan(1, "checks_only");
    p.scope = ["."];
    p.tasks[0].scope = ["."];
    p.deliveryTarget = "inline_preview";
    p.gates[0].commands = [
      `node -e "require('node:assert/strict').ok(require('node:fs').existsSync('src/animation.ts'))"`,
    ];
    f.e.workflow.submit("c", p);
    await assert.rejects(f.e.action("c", { type: "finish" }));
    await drain(f.e);
    const s = f.e.state("c");
    assert.equal(s.status, "done");
    assert.equal(s.cycle.deliveryTarget, "inline_preview");
    assert.ok(
      s.artifacts.some(
        (a) =>
          a.sourceCommit === s.cycle.finalCommit && a.kind === "static_page",
      ),
    );
    assert.equal(calls, 1);
    f.p.validate("c");
    assert.equal(f.e.state("c").artifacts[0].validationStatus, "verified");
  } finally {
    f.clean();
  }
});
test('P1：CLI 实际构建事件自动登记，不等待终止消息；失败与取消不登记迟到结果，恢复后可更新', async () => {
  const f=setup();
  try {
    mkdirSync(join(f.path,'dist'));
    writeFileSync(join(f.path,'dist/index.html'),'<h1>first</h1>');
    const event=(type,exit_code=0)=>({type,item:{type:'command_execution',command:"/bin/bash -lc 'npm run build'",exit_code,aggregated_output:'build failed'}});
    const meta={cwd:f.path,runId:'run',eventId:21,taskId:'task'};
    f.e.event('c','task',{id:'task',status:'running'});
    f.p.observeModelBuild('c',event('item.started'),meta);
    assert.equal(f.e.state('c').preview.status,'building');
    f.p.observeModelBuild('c',event('item.completed'),meta);
    await f.p.active.get(f.path);
    assert.equal(f.p.store.list('c').length,1);
    assert.deepEqual(f.p.store.list('c')[0].buildEvidenceIds,[21]);
    assert.equal(f.p.store.list('c')[0].validationStatus,'draft');
    assert.ok(!f.e.state('c').events.some(e=>e.type==='model_result'));
    f.p.observeModelBuild('c',event('item.completed',1),meta);
    assert.equal(f.e.state('c').preview.status,'failed');
    writeFileSync(join(f.path,'dist/index.html'),'<h1>second</h1>');
    const pending=f.p.request('c',meta);
    f.e.event('c','task_update',{id:'task',status:'cancelled'});
    await pending;
    assert.equal(f.p.store.list('c').length,1);
    assert.equal(f.e.state('c').preview.status,'stopped');
    f.p.observeModelBuild('c',event('item.completed'),meta);
    assert.equal(f.p.active.size,0);
    f.e.event('c','task_update',{id:'task',status:'running'});
    f.e.event('c','status',{status:'paused'});
    f.p.observeModelBuild('c',event('item.completed'),meta);
    assert.equal(f.p.active.size,0);
    f.e.event('c','status',{status:'working'});
    f.p.observeModelBuild('c',event('item.completed'),meta);
    await f.p.active.get(f.path);
    assert.equal(f.p.store.list('c').length,2);
  } finally {f.clean();}
});
test('P1：切换批次拒绝迟到产物；相同提交在新批次重新关联而不复用旧验收', async () => {
  const f=setup();
  try {
    const commit=f.e.git(f.path,['rev-parse','HEAD']);
    f.e.event('c','cycle',{cycleId:'one',generation:1});
    await f.p.request('c',{sourceCommit:commit,cycleId:'one'});
    const pending=f.p.request('c',{cycleId:'one'});
    f.e.event('c','cycle',{cycleId:'two',generation:1});
    await pending;
    assert.equal(f.p.store.list('c').length,1);
    await f.p.request('c',{sourceCommit:commit,cycleId:'two'});
    assert.equal(f.p.store.list('c').length,2);
    assert.equal(f.p.store.list('c')[1].cycleId,'two');
    assert.equal(f.p.store.list('c')[1].validationStatus,'draft');
  } finally {f.clean();}
});
