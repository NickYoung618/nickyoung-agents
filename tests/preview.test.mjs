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
